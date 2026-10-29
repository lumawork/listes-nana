-- Mes Missions V11: planned, list-scoped migration to the shared occurrence engine.
-- Existing payloads are retained and become read-only per migrated list.
create table nm_private.migration_links(
 id uuid primary key default gen_random_uuid(),family_id uuid not null references nm_private.homes,
 source_kind text not null check(source_kind in ('personal','shared')),source_owner uuid not null,
 source_list text not null,person text not null check(person in ('annabelle','papa','maman')),
 snapshot_id uuid not null references nm_private.legacy_snapshots,source_hash text not null,
 migrated_at timestamptz not null default now(),actor uuid not null,active boolean not null default true,
 unique(source_kind,source_owner,source_list));
alter table nm_private.migration_links enable row level security;
revoke all on nm_private.migration_links from public,anon,authenticated;
create function nm_private.legacy_source(p_uid uuid,p_kind text,p_owner uuid,p_list text) returns jsonb language plpgsql set search_path='' as $$
declare profile mm_private.mm_profiles;other mm_private.mm_profiles;payload jsonb;rev bigint;list jsonb;history jsonb;owner uuid;begin
 select * into profile from mm_private.mm_profiles where user_id=p_uid;if not found then raise exception 'AUTH_REQUIRED';end if;
 if p_kind='personal' then
 owner:=coalesce(p_owner,p_uid);select * into other from mm_private.mm_profiles where user_id=owner;
 if other.family_id is distinct from profile.family_id or (owner<>p_uid and not(profile.kind='adult' and other.kind='child' and exists(select 1 from mm_private.mm_guardians where parent_id=p_uid and child_id=owner))) then raise exception 'SOURCE_ACCESS_DENIED';end if;
 if other.legacy_child then select s.payload,s.revision into payload,rev from mm_private.mm_state s where s.family_id=other.family_id;
 else select s.payload,s.revision into payload,rev from mm_private.mm_personal_state s where s.user_id=owner;end if;
 select value into list from jsonb_array_elements(coalesce(payload->'lists','[]')) where value->>'id'=p_list;
 select coalesce(jsonb_agg(z||jsonb_build_object('lists',(select jsonb_agg(l) from jsonb_array_elements(z->'lists')l where l->>'id'=p_list))),'[]') into history from jsonb_array_elements(coalesce(payload->'history','[]'))z where exists(select 1 from jsonb_array_elements(z->'lists')l where l->>'id'=p_list);
 elsif p_kind='shared' then
 select s.payload,s.revision,s.created_by into list,rev,owner from mm_private.mm_shared_lists s join mm_private.mm_shared_members m on m.list_id=s.id where s.id::text=p_list and s.family_id=profile.family_id and s.deleted_at is null and m.user_id=p_uid and m.role='owner';
 history:='[]';payload:=jsonb_build_object('settings','{}'::jsonb);
 else raise exception 'INVALID_SOURCE';end if;
 if list is null then raise exception 'SOURCE_NOT_FOUND';end if;
 return jsonb_build_object('owner',owner,'revision',rev,'list',list,'settings',payload->'settings','history',history,'hash',nm_private.hash(p_kind||owner::text||list::text||coalesce(history::text,'')));
end$$;
create function nm_private.legacy_dispatch(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();profile mm_private.mm_profiles;src jsonb;l jsonb;item jsonb;link nm_private.migration_links;req uuid;fp text;prior nm_private.requests;kind text;owner uuid;person text;firstday date;task jsonb;spec jsonb;due timestamptz;tasks jsonb:='[]';snapshotid uuid;sourcekey text;hist jsonb;i int;answer jsonb;cfg jsonb;ownlists jsonb;sharelists jsonb;begin
 if uid is null then raise exception 'AUTH_REQUIRED';end if;
 select * into profile from mm_private.mm_profiles where user_id=uid;if not found then raise exception 'PROFILE_REQUIRED';end if;
 if octet_length(p_data::text)>1500000 then raise exception 'INVALID_REQUEST';end if;
 if p_action='sources' then
 select coalesce(jsonb_agg(jsonb_build_object('kind','personal','owner',p.user_id,'name',p.display_name,'profileKind',p.kind,'self',p.user_id=uid)),'[]') into ownlists from mm_private.mm_profiles p where p.user_id=uid or (profile.kind='adult' and p.kind='child' and p.family_id=profile.family_id and exists(select 1 from mm_private.mm_guardians where parent_id=uid and child_id=p.user_id));
 select coalesce(jsonb_agg(jsonb_build_object('kind','shared','id',s.id,'name',s.payload->>'title','owner',s.created_by)),'[]') into sharelists from mm_private.mm_shared_lists s join mm_private.mm_shared_members m on m.list_id=s.id where m.user_id=uid and m.role='owner' and s.family_id=profile.family_id and s.deleted_at is null;
 return jsonb_build_object('personal',ownlists,'shared',sharelists,'links',coalesce((select jsonb_agg(jsonb_build_object('kind',m.source_kind,'owner',m.source_owner,'listId',m.source_list,'person',m.person,'at',m.migrated_at,'active',m.active)) from nm_private.migration_links m where m.family_id=profile.family_id and (m.source_owner=uid or m.source_kind='shared' or exists(select 1 from mm_private.mm_guardians where parent_id=uid and child_id=m.source_owner))),'[]'));
 end if;
 kind:=coalesce(p_data->>'kind','personal');owner:=coalesce((p_data->>'owner')::uuid,uid);
 if p_action='lists' then
 -- Only the owner and explicitly attached guardians may inventory private lists.
 if owner<>uid and not exists(select 1 from mm_private.mm_guardians g join mm_private.mm_profiles p on p.user_id=g.child_id where g.parent_id=uid and g.child_id=owner and profile.kind='adult' and p.family_id=profile.family_id and p.kind='child') then raise exception 'SOURCE_ACCESS_DENIED';end if;
 select case when p.legacy_child then s.payload else o.payload end into l from mm_private.mm_profiles p left join mm_private.mm_state s on s.family_id=p.family_id left join mm_private.mm_personal_state o on o.user_id=p.user_id where p.user_id=owner and p.family_id=profile.family_id;
 return jsonb_build_object('lists',coalesce((select jsonb_agg(jsonb_build_object('id',z->>'id','title',z->>'title','tasks',jsonb_array_length(z->'tasks'),'checked',(select count(*) from jsonb_array_elements(z->'tasks')t where t->>'done'='true'),'resetMode',z->>'resetMode','migrated',exists(select 1 from nm_private.migration_links m where m.source_kind='personal' and m.source_owner=owner and m.source_list=z->>'id' and m.active))) from jsonb_array_elements(coalesce(l->'lists','[]'))z),'[]'));
 end if;
 if p_action not in ('plan','apply') then raise exception 'UNKNOWN_ACTION';end if;
 if p_action='apply' then
 req:=(p_data->>'requestId')::uuid;if req is null then raise exception 'REQUEST_REQUIRED';end if;fp:=nm_private.hash(p_action||p_data::text);perform pg_advisory_xact_lock(hashtext('legacy:'||uid::text||req::text));
 select * into prior from nm_private.requests where principal='user:'||uid::text and request_id=req;if found then if prior.fingerprint<>fp then raise exception 'REQUEST_REUSED';end if;return prior.result;end if;
 end if;
 if p_action='apply' then
 perform nm_private.dispatch('snapshot','{}',null);
 if kind='shared' then perform 1 from mm_private.mm_shared_lists where id::text=p_data->>'listId' for update;
 elsif exists(select 1 from mm_private.mm_profiles where user_id=owner and legacy_child) then perform 1 from mm_private.mm_state where family_id=profile.family_id for update;
 else perform 1 from mm_private.mm_personal_state where user_id=owner for update;end if;
 end if;
 src:=nm_private.legacy_source(uid,kind,owner,p_data->>'listId');owner:=(src->>'owner')::uuid;l:=src->'list';person:=p_data->>'person';
 if person not in ('annabelle','papa','maman') or person is null then raise exception 'INVALID_PERSON';end if;
 if profile.kind='child' and (person<>'annabelle' or owner<>uid) then raise exception 'SCOPE_DENIED';end if;
 firstday:=(p_data->>'start')::date;if firstday is null or firstday<(now() at time zone 'Europe/Paris')::date or firstday>(now() at time zone 'Europe/Paris')::date+366 then raise exception 'INVALID_START';end if;
 for task in select value from jsonb_array_elements(l->'tasks') loop
 spec:=jsonb_build_object('mode',case when l->>'resetMode'='manual' then 'once' else 'fixed' end,'every',case when l->>'resetMode'='weekly' then 7 else 1 end,'unit','days','days',coalesce(l->'activeDays','[0,1,2,3,4,5,6]'),'paused',case when l?'activeDays' then jsonb_array_length(l->'activeDays')=0 else false end,'pausedUntil',l->>'pausedUntil','reminder',false,'reminderTime',coalesce(nullif(task->>'time',''),l->'reminder'->>'time','08:00'),'followup',coalesce(l->'reminder'->'followup','true'),'reminderDelay',coalesce(l->'reminder'->'delay','15'),'reminderCount',case when l->'reminder'->>'followup'='false' then 0 else 2 end,'legacyReminder',l->'reminder','legacyDone',task->'done','ui',jsonb_build_object('listId',kind||':'||owner::text||':'||(l->>'id'),'title',l->>'title','icon',l->>'icon','group',l->>'group','note',l->>'note','color',l->>'color','visualTheme',coalesce(nullif(l->>'visualTheme','inherit'),src->'settings'->>'universe','original')));
 due:=(firstday+coalesce(nullif(task->>'time','')::time,'08:00'::time)) at time zone 'Europe/Paris';
 if l->>'resetMode'='weekly' and jsonb_array_length(spec->'days')>0 then
 for i in 0..6 loop if spec->'days' @> to_jsonb(extract(dow from (due at time zone 'Europe/Paris'))::int) then exit;end if;due:=((due at time zone 'Europe/Paris')+interval '1 day') at time zone 'Europe/Paris';end loop;
 end if;
 spec:=spec||jsonb_build_object('firstDue',to_char(due at time zone 'Europe/Paris','YYYY-MM-DD"T"HH24:MI'));
 tasks:=tasks||jsonb_build_array(jsonb_build_object('sourceTask',task->>'id','title',task->>'text','person',person,'spec',spec,'firstDue',due));
 end loop;
 answer:=jsonb_build_object('hash',src->>'hash','revision',src->'revision','listId',l->>'id','title',l->>'title','owner',owner,'kind',kind,'person',person,'taskCount',jsonb_array_length(tasks),'checkedObservations',(select count(*) from jsonb_array_elements(l->'tasks')t where t->>'done'='true'),'tasks',tasks,'snapshot',jsonb_build_object('version',1,'lists',jsonb_build_array(l),'settings',src->'settings','history',src->'history'),'warning','Cette liste sera visible aux personnes autorisées du foyer ; ses anciennes coches resteront des observations, sans heure de réalisation inventée. Les nouveaux rappels restent désactivés.');
 if p_action='plan' then return answer;end if;
 if not coalesce((p_data->>'confirmFamilyVisibility')::boolean,false) then raise exception 'SHARING_ACK_REQUIRED';end if;
 if p_data->>'hash' is distinct from src->>'hash' then raise exception 'SOURCE_CHANGED';end if;
 perform nm_private.dispatch('snapshot','{}',null);
 perform 1 from nm_private.homes where family_id=profile.family_id for update;
 select * into link from nm_private.migration_links where source_kind=kind and source_owner=owner and source_list=l->>'id';
 if found then
 if link.active then return jsonb_build_object('ok',true,'alreadyMigrated',true,'id',link.id);else raise exception 'MIGRATION_INACTIVE';end if;
 end if;
 insert into nm_private.legacy_snapshots(family_id,source_hash,payload) values(profile.family_id,src->>'hash',answer->'snapshot') on conflict(family_id,source_hash) do update set source_hash=excluded.source_hash returning id into snapshotid;
 insert into nm_private.migration_links(family_id,source_kind,source_owner,source_list,person,snapshot_id,source_hash,actor) values(profile.family_id,kind,owner,l->>'id',person,snapshotid,src->>'hash',uid) returning * into link;
 for item in select value from jsonb_array_elements(tasks) loop
 sourcekey:='v11:'||kind||':'||owner::text||':'||(l->>'id')||':'||(item->>'sourceTask');
 insert into nm_private.defs(family_id,person,title,spec,next_due,source_key) values(profile.family_id,person,item->>'title',(item->'spec')||jsonb_build_object('migrationId',link.id),(item->>'firstDue')::timestamptz,sourcekey) on conflict(family_id,source_key) do nothing;
 end loop;
 select config into cfg from nm_private.homes where family_id=profile.family_id;
 -- Assign only when this is the selected source person's own profile; no other adult's identity is inferred.
 if kind='personal' then cfg:=jsonb_set(cfg,'{people}',(select jsonb_agg(case when z->>'id'=person then z||jsonb_build_object('userId',owner) when z->>'userId'=owner::text then z-'userId' else z end) from jsonb_array_elements(cfg->'people')z));update nm_private.homes set config=cfg where family_id=profile.family_id;end if;
 perform nm_private.generate(profile.family_id);update nm_private.homes set revision=revision+1 where family_id=profile.family_id;
 insert into nm_private.events(family_id,actor,kind,after_data,reason) values(profile.family_id,uid,'migrate',jsonb_build_object('migrationId',link.id,'count',jsonb_array_length(tasks),'sourceRevision',src->'revision'),'Reprise de la liste choisie ; original conservé et rappels V10 bloqués');
 answer:=jsonb_build_object('ok',true,'id',link.id,'taskCount',jsonb_array_length(tasks),'snapshotId',snapshotid);
 insert into nm_private.requests values('user:'||uid::text,req,fp,answer);return answer;
end$$;
create function public.nm_legacy(p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select nm_private.legacy_dispatch(p_action,p_data)$$;
revoke all on function nm_private.legacy_source(uuid,text,uuid,text),nm_private.legacy_dispatch(text,jsonb),public.nm_legacy(text,jsonb) from public,anon,authenticated;
grant execute on function nm_private.legacy_dispatch(text,jsonb),public.nm_legacy(text,jsonb) to authenticated;
create function nm_private.legacy_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare m record;beforelist jsonb;afterlist jsonb;owner uuid;family uuid;begin
 if tg_table_name='mm_shared_lists' then
 if exists(select 1 from nm_private.migration_links where source_kind='shared' and source_list=old.id::text and active) then
 if tg_op='DELETE' then raise exception 'MIGRATED_LIST_READONLY';end if;
 if new.payload is distinct from old.payload or new.deleted_at is distinct from old.deleted_at then raise exception 'MIGRATED_LIST_READONLY';end if;
 end if;
 else
 for m in select l.* from nm_private.migration_links l join mm_private.mm_profiles p on p.user_id=l.source_owner where l.active and l.source_kind='personal' and ((tg_table_name='mm_personal_state' and l.source_owner=(to_jsonb(old)->>'user_id')::uuid) or (tg_table_name='mm_state' and p.legacy_child and p.family_id=(to_jsonb(old)->>'family_id')::uuid)) loop
 if tg_op='DELETE' then raise exception 'MIGRATED_LIST_READONLY';end if;
 select value into beforelist from jsonb_array_elements(old.payload->'lists') where value->>'id'=m.source_list;
 select value into afterlist from jsonb_array_elements(new.payload->'lists') where value->>'id'=m.source_list;
 if beforelist is distinct from afterlist then raise exception 'MIGRATED_LIST_READONLY';end if;
 end loop;
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end$$;
revoke all on function nm_private.legacy_guard() from public,anon,authenticated;
create trigger nm_legacy_personal_guard before update or delete on mm_private.mm_personal_state for each row execute function nm_private.legacy_guard();
create trigger nm_legacy_child_guard before update or delete on mm_private.mm_state for each row execute function nm_private.legacy_guard();
create trigger nm_legacy_shared_guard before update or delete on mm_private.mm_shared_lists for each row execute function nm_private.legacy_guard();
create function nm_private.legacy_push_allowed(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from mm_private.mm_push_deliveries d join mm_private.mm_push_subscriptions s on s.id=d.subscription_id join nm_private.migration_links m on m.active and ((m.source_kind='personal' and m.source_owner=s.user_id and m.source_list=d.list_id) or (m.source_kind='shared' and 'shared:'||m.source_list=d.list_id)) where d.id=p_id and d.kind<>'test')
$$;
revoke all on function nm_private.legacy_push_allowed(uuid) from public,anon,authenticated;
grant execute on function nm_private.legacy_push_allowed(uuid) to service_role;
create or replace function public.mm_push_can_send(p_id uuid,p_lease uuid) returns boolean language sql security invoker set search_path='' as $$select mm_private.mm_push_can_send(p_id,p_lease) and nm_private.legacy_push_allowed(p_id)$$;
create function nm_private.legacy_notification_allowed(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from mm_private.mm_push_deliveries d join mm_private.mm_push_subscriptions s on s.id=d.subscription_id join mm_private.mm_profiles p on p.user_id=s.user_id where d.id=p_id and s.user_id=auth.uid() and d.due_at>now()-interval '15 minutes' and nm_private.legacy_push_allowed(d.id))
$$;
create function public.nm_legacy_notification(p_id uuid) returns boolean language sql security invoker set search_path='' as $$select nm_private.legacy_notification_allowed(p_id)$$;
revoke all on function nm_private.legacy_notification_allowed(uuid),public.nm_legacy_notification(uuid) from public,anon,authenticated;
grant execute on function nm_private.legacy_notification_allowed(uuid),public.nm_legacy_notification(uuid) to authenticated;
