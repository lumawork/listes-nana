-- Extension V12. À exécuter une fois sur la base V11 existante, avant les deux interfaces.
-- Réexécutable ; aucun accès réel ni aucune reprise ne sont exécutés par ce fichier.
begin;
do $$begin
 if to_regclass('nm_private.migration_links') is null then raise exception 'V11_ENGINE_REQUIRED';end if;
 if to_regprocedure('nm_private.dispatch_v11(text,jsonb,text)') is null then
  alter function nm_private.dispatch(text,jsonb,text) rename to dispatch_v11;
 end if;
end$$;
create table if not exists nm_private.upgrades_v12(
 owner uuid not null, family_id uuid not null, list_id text not null,
 definition_id uuid references nm_private.defs(id), snapshot_id uuid,
 report jsonb not null, at timestamptz not null default now(),primary key(owner,list_id));
alter table nm_private.upgrades_v12 enable row level security;
revoke all on nm_private.upgrades_v12 from public,anon,authenticated;
create or replace function nm_private.steps_valid(s jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare x jsonb;seen text[]:='{}';begin
 if s is null then return true;end if;
 if jsonb_typeof(s)<>'array' or jsonb_array_length(s)>300 then return false;end if;
 for x in select value from jsonb_array_elements(s) loop
  if jsonb_typeof(x)<>'object' or coalesce(length(x->>'id'),0) not between 1 and 100 or x->>'id'=any(seen) or coalesce(length(trim(x->>'title')),0) not between 1 and 500 then return false;end if;
  if coalesce(x->>'time','')<>'' and x->>'time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return false;end if;
  seen:=array_append(seen,x->>'id');
 end loop;return true;
end$$;
revoke all on function nm_private.steps_valid(jsonb) from public,anon,authenticated;
create or replace function nm_private.bootstrap_v12(p_person text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();p mm_private.mm_profiles;h nm_private.homes;payload jsonb;l jsonb;src jsonb;spec jsonb;steps jsonb;done jsonb;st jsonb;olddef nm_private.defs;oldocc nm_private.occ;
 person text;snapshotid uuid;definitionid uuid;linkid uuid;due timestamptz;today date:=(now() at time zone 'Europe/Paris')::date;report jsonb:='[]';rowreport jsonb;mode text;listid text;n int;prior jsonb;allchecked boolean;mixed boolean;groupid text;active jsonb;weekdays jsonb;nextday date;loops int;
begin
 if uid is null then raise exception 'AUTH_REQUIRED';end if;
 select * into p from mm_private.mm_profiles where user_id=uid;if not found then raise exception 'PROFILE_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtext('bootstrap-v12:'||uid::text));
 perform nm_private.dispatch_v11('snapshot','{}',null);
 select * into h from nm_private.homes where family_id=p.family_id for update;
 if p.kind='child' then person:='annabelle';else select z->>'id' into person from jsonb_array_elements(h.config->'people')z where z->>'userId'=uid::text limit 1;end if;
 if person is null then
  if p_person not in ('papa','maman','annabelle') or p_person is null then return jsonb_build_object('needsPerson',true);end if;
  if exists(select 1 from jsonb_array_elements(h.config->'people')z where z->>'id'=p_person and coalesce(z->>'userId','') not in ('',uid::text)) then raise exception 'PERSON_ALREADY_ASSIGNED';end if;
  person:=p_person;
 end if;
 if p.kind='child' and person<>'annabelle' then raise exception 'SCOPE_DENIED';end if;
 -- Explicit role selection only; never infer a role from name or email.
 if not exists(select 1 from jsonb_array_elements(h.config->'people')z where z->>'id'=person and z->>'userId'=uid::text) then
  if exists(select 1 from jsonb_array_elements(h.config->'people')z where z->>'id'=person and coalesce(z->>'userId','') not in ('',uid::text)) then raise exception 'PERSON_ALREADY_ASSIGNED';end if;
  update nm_private.homes set config=jsonb_set(config,'{people}',(select jsonb_agg(case when z->>'id'=person then z||jsonb_build_object('userId',uid) else z end) from jsonb_array_elements(config->'people')z)),revision=revision+1 where family_id=p.family_id;
 end if;
 if p.legacy_child then select s.payload into payload from mm_private.mm_state s where s.family_id=p.family_id for update;else select s.payload into payload from mm_private.mm_personal_state s where s.user_id=uid for update;end if;
 for l in select value from jsonb_array_elements(coalesce(payload->'lists','[]')) loop
  listid:=l->>'id';select u.report into prior from nm_private.upgrades_v12 u where u.owner=uid and u.list_id=listid;
  if found then report:=report||jsonb_build_array(prior);continue;end if;
  src:=nm_private.legacy_source(uid,'personal',uid,listid);
  -- Backup retains original checks and the filtered observation history; no completion time invented.
  insert into nm_private.legacy_snapshots(family_id,source_hash,payload) values(p.family_id,'v12:'||(src->>'hash'),jsonb_build_object('version',1,'lists',jsonb_build_array(l),'settings',payload->'settings','history',src->'history')) on conflict(family_id,source_hash) do update set source_hash=excluded.source_hash returning id into snapshotid;
  mixed:=exists(select 1 from nm_private.defs d where d.family_id=p.family_id and d.spec->>'migrationId' in (select m.id::text from nm_private.migration_links m where m.source_kind='personal' and m.source_owner=uid and m.source_list=listid) and not d.archived and (d.version>1 or exists(select 1 from nm_private.occ z where z.def_id=d.id and (z.status='done' or z.version>1 or (z.status='open' and z.original_end<=now())))));
  if mixed then
   rowreport:=jsonb_build_object('list',l->>'title','status','preserved','reason','Historique, retards ou calendrier personnalisé : missions existantes conservées','snapshotId',snapshotid);
   insert into nm_private.upgrades_v12 values(uid,p.family_id,listid,null,snapshotid,rowreport,now());report:=report||jsonb_build_array(rowreport);continue;
  end if;
  steps:='[]';done:='{}';allchecked:=jsonb_array_length(l->'tasks')>0;
  for st in select value from jsonb_array_elements(l->'tasks') loop
   steps:=steps||jsonb_build_array(jsonb_build_object('id',coalesce(nullif(st->>'id',''),md5(st::text)),'title',st->>'text','time',coalesce(st->>'time','')));
   if st->>'done'='true' then done:=done||jsonb_build_object(st->>'id',true);else allchecked:=false;end if;
  end loop;
  if not nm_private.steps_valid(steps) then raise exception 'INVALID_STEPS';end if;
  mode:=coalesce(l->>'resetMode',case when l->>'weekly'='true' then 'weekly' else 'manual' end);
  weekdays:=coalesce(l->'activeDays','[0,1,2,3,4,5,6]');
  groupid:='group:'||md5(person||':'||coalesce(nullif(l->>'group',''),'Maison'));
  spec:=jsonb_build_object('mode',case when mode='manual' then 'none' else 'fixed' end,'unit','days','every',case when mode='weekly' then 7 else 1 end,'dueType','day','days',weekdays,'paused',jsonb_array_length(weekdays)=0,'pausedUntil',l->>'pausedUntil','steps',steps,'reminder',coalesce((l->'reminder'->>'enabled')::boolean,false),'reminderTime',coalesce(l->'reminder'->>'time',''),'reminderDelay',coalesce((l->'reminder'->>'delay')::int,15),'reminderCount',case when l->'reminder'->>'followup'='false' then 0 else 2 end,'ui',jsonb_build_object('listId',groupid,'title',coalesce(nullif(l->>'group',''),'Maison'),'icon',l->>'icon','visualTheme',coalesce(l->>'visualTheme',payload->'settings'->>'universe','inherit'),'note',l->>'note','legacyTitle',l->>'title'));
  due:=null;nextday:=today;
  if mode<>'manual' and jsonb_array_length(weekdays)>0 then
   if allchecked and coalesce(l->>'day','')=today::text then nextday:=today+case when mode='weekly' then 7 else 1 end;done:='{}';end if;
   loops:=0;while not weekdays @> to_jsonb(extract(dow from nextday)::int) and loops<7 loop nextday:=nextday+1;loops:=loops+1;end loop;
   due:=nextday::timestamp at time zone 'Europe/Paris';spec:=spec||jsonb_build_object('firstDue',nextday::text||'T00:00');
  else spec:=spec||jsonb_build_object('reminder',false);end if;
  -- Existing open occurrences are replaced transactionally, with before-images retained as audit events.
  for olddef in select d.* from nm_private.defs d join nm_private.migration_links m on d.spec->>'migrationId'=m.id::text where m.source_owner=uid and m.source_kind='personal' and m.source_list=listid and not d.archived loop
   for oldocc in select * from nm_private.occ where def_id=olddef.id and status='open' for update loop
    insert into nm_private.events(family_id,occ_id,actor,kind,before_data,reason) values(p.family_id,oldocc.id,uid,'upgrade_v12',to_jsonb(oldocc),'Remplacée par une mission avec étapes ; original sauvegardé');
    update nm_private.occ set status='cancelled',version=version+1 where id=oldocc.id;
   end loop;
   update nm_private.defs set archived=true,version=version+1 where id=olddef.id;
  end loop;
  insert into nm_private.defs(family_id,person,title,spec,next_due,source_key) values(p.family_id,person,l->>'title',spec,due,'v12:personal:'||uid::text||':'||listid) returning id into definitionid;
  select m.id into linkid from nm_private.migration_links m where m.source_kind='personal' and m.source_owner=uid and m.source_list=listid;
  if linkid is not null then update nm_private.migration_links set active=true where id=linkid;end if;
  if linkid is null then
   insert into nm_private.migration_links(family_id,source_kind,source_owner,source_list,person,snapshot_id,source_hash,actor) values(p.family_id,'personal',uid,listid,person,snapshotid,src->>'hash',uid) returning id into linkid;
  end if;
  perform nm_private.generate(p.family_id);
  if done<>'{}' and coalesce(l->>'day','')=today::text then
   update nm_private.occ as z set spec=z.spec||jsonb_build_object('stepDone',done,'legacyProgress',true) where def_id=definitionid and status='open' and (original_due at time zone 'Europe/Paris')::date=today;
  end if;
  rowreport:=jsonb_build_object('list',l->>'title','status',case when due is null then 'unscheduled' else 'imported' end,'steps',jsonb_array_length(steps),'snapshotId',snapshotid,'definitionId',definitionid,'legacyChecked',done);
  insert into nm_private.upgrades_v12 values(uid,p.family_id,listid,definitionid,snapshotid,rowreport,now());report:=report||jsonb_build_array(rowreport);
  insert into nm_private.events(family_id,actor,kind,after_data,reason) values(p.family_id,uid,'upgrade_v12',rowreport,'Reprise unique des listes personnelles vers missions avec étapes');
  update nm_private.homes set revision=revision+1 where family_id=p.family_id;
 end loop;
 return jsonb_build_object('ok',true,'person',person,'report',report);
end$$;
revoke all on function nm_private.bootstrap_v12(text) from public,anon,authenticated;
create or replace function nm_private.dispatch(p_action text,p_data jsonb,p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare snap jsonb;o nm_private.occ;d nm_private.defs;spec jsonb;outv jsonb;prior nm_private.requests;vprincipal text;req uuid;fp text;checked jsonb;sid text;completeid uuid;family uuid;who text;uid uuid:=auth.uid();nextid uuid;beforejson jsonb;
begin
 if p_data is null or octet_length(p_data::text)>1500000 then raise exception 'INVALID_REQUEST';end if;
 if p_action in ('create','edit') and p_data?'spec' then p_data:=jsonb_set(p_data,'{spec}',(p_data->'spec')-'stepDone'-'legacyProgress');end if;
 if p_action in ('create','edit') and not nm_private.steps_valid(p_data->'spec'->'steps') then raise exception 'INVALID_STEPS';end if;
 if p_action not in ('snapshot','export','history','bootstrap','complete','step','create','edit') or (p_action in ('create','edit') and p_data->'spec'->>'mode' is distinct from 'none') then
  return nm_private.dispatch_v11(p_action,p_data,p_token);
 end if;
 snap:=nm_private.dispatch_v11('snapshot',case when p_action='snapshot' then p_data else '{}'::jsonb end,p_token);
 if p_action='bootstrap' then
  if snap->>'deviceId' is not null then raise exception 'SCOPE_DENIED';end if;
  return nm_private.bootstrap_v12(p_data->>'person');
 end if;
 if p_action in ('snapshot','export','history') then
  if p_action='snapshot' then outv:=snap;else outv:=nm_private.dispatch_v11(p_action,p_data,p_token);end if;
  return outv||jsonb_build_object('apiVersion',12,'upgradeReport',coalesce((select jsonb_agg(u.report) from nm_private.upgrades_v12 u where u.owner=uid and snap->>'deviceId' is null),'[]'));
 end if;
 if p_action in ('create','edit') and p_data?'spec' then p_data:=jsonb_set(p_data,'{spec}',(p_data->'spec')-'stepDone'-'legacyProgress');end if;
 if p_action in ('create','edit') and not nm_private.steps_valid(p_data->'spec'->'steps') then raise exception 'INVALID_STEPS';end if;
 if p_action='complete' then
  select * into o from nm_private.occ where id=(p_data->>'id')::uuid and exists(select 1 from jsonb_array_elements(snap->'occurrences')z where z->>'id'=id::text);
  if o.id is null then raise exception 'SCOPE_DENIED';end if;
  if exists(select 1 from jsonb_array_elements(coalesce(o.spec->'steps','[]'))z where coalesce(o.spec->'stepDone'->> (z->>'id'),'false')<>'true') then raise exception 'STEPS_INCOMPLETE';end if;
 end if;
 if p_action<>'step' and not (p_action in ('create','edit') and p_data->'spec'->>'mode'='none') then return nm_private.dispatch_v11(p_action,p_data,p_token);end if;
 if snap->>'deviceId' is not null then vprincipal:='device:'||(snap->>'deviceId');else vprincipal:='user:'||uid::text;end if;
 req:=(p_data->>'requestId')::uuid;if req is null then raise exception 'REQUEST_REQUIRED';end if;
 fp:=nm_private.hash(p_action||p_data::text);perform pg_advisory_xact_lock(hashtext(vprincipal||req::text));
 select * into prior from nm_private.requests r where r.principal=vprincipal and r.request_id=req;
 if found then if prior.fingerprint<>fp then raise exception 'REQUEST_REUSED';end if;return prior.result;end if;
 if p_action='step' then
  select * into o from nm_private.occ t where t.id=(p_data->>'id')::uuid and exists(select 1 from jsonb_array_elements(snap->'occurrences')z where z->>'id'=t.id::text) for update;
  if o.id is null then raise exception 'SCOPE_DENIED';end if;
  if o.status<>'open' or o.visible>now() then raise exception 'ALREADY_TERMINAL';end if;
  if o.version is distinct from (p_data->>'version')::bigint then raise exception 'VERSION_CONFLICT';end if;
  sid:=p_data->>'stepId';if not exists(select 1 from jsonb_array_elements(coalesce(o.spec->'steps','[]'))z where z->>'id'=sid) then raise exception 'STEP_NOT_FOUND';end if;
  if jsonb_typeof(p_data->'done') is distinct from 'boolean' then raise exception 'INVALID_REQUEST';end if;
  beforejson:=to_jsonb(o);checked:=coalesce(o.spec->'stepDone','{}')||jsonb_build_object(sid,(p_data->>'done')::boolean);
  update nm_private.occ as z set spec=z.spec||jsonb_build_object('stepDone',checked),version=version+1 where id=o.id;
  insert into nm_private.events(family_id,occ_id,actor,device,kind,before_data,after_data) values(o.family_id,o.id,uid,(snap->>'deviceId')::uuid,'step',beforejson,jsonb_build_object('stepId',sid,'done',p_data->'done'));
  update nm_private.homes set revision=revision+1 where family_id=o.family_id;
  outv:=jsonb_build_object('ok',true,'completed',false);
  if not exists(select 1 from jsonb_array_elements(o.spec->'steps')z where coalesce(checked->>(z->>'id'),'false')<>'true') then
   completeid:=md5(req::text||':complete')::uuid;
   perform nm_private.dispatch_v11('complete',jsonb_build_object('id',o.id,'version',o.version+1,'requestId',completeid),p_token);
   outv:=jsonb_build_object('ok',true,'completed',true);
  end if;
 else
  if snap->>'deviceId' is not null or (not (snap->>'admin')::boolean and snap->>'personScope' is distinct from p_data->>'person') then raise exception 'SCOPE_DENIED';end if;
  who:=p_data->>'person';if who not in ('annabelle','papa','maman') or who is null or coalesce(length(trim(p_data->>'title')),0) not between 1 and 500 then raise exception 'INVALID_TITLE';end if;
  select family_id into family from mm_private.mm_profiles where user_id=uid;
  spec:=p_data->'spec';if not nm_private.schedule_valid(spec||jsonb_build_object('mode','once','every',1,'unit','days','firstDue','2099-01-01T00:00')) then raise exception 'INVALID_SCHEDULE';end if;
  if p_action='edit' then
   select * into d from nm_private.defs t where t.id=(p_data->>'id')::uuid and t.family_id=family for update;
   if d.id is null or (not (snap->>'admin')::boolean and d.person is distinct from snap->>'personScope') then raise exception 'SCOPE_DENIED';end if;
   if d.version is distinct from (p_data->>'version')::bigint then raise exception 'VERSION_CONFLICT';end if;
   perform nm_private.dispatch_v11('archive',jsonb_build_object('id',d.id,'version',d.version,'requestId',md5(req::text||':archive')::uuid),p_token);
  end if;
  insert into nm_private.defs(family_id,person,title,spec,next_due) values(family,who,trim(p_data->>'title'),spec||jsonb_build_object('reminder',false),null) returning id into nextid;
  update nm_private.homes set revision=revision+1 where family_id=family;
  insert into nm_private.events(family_id,actor,kind,after_data) values(family,uid,'create_unscheduled',jsonb_build_object('id',nextid,'title',p_data->>'title'));
  outv:=jsonb_build_object('ok',true,'id',nextid);
 end if;
 insert into nm_private.requests values(vprincipal,req,fp,outv);return outv;
end$$;
-- Rebind the public API to the new dispatcher; permissions stay explicit.
create or replace function public.nm_rpc(p_action text,p_data jsonb default '{}',p_token text default null) returns jsonb language sql security invoker set search_path='' as $$select nm_private.dispatch(p_action,p_data,p_token)$$;
revoke all on function nm_private.dispatch(text,jsonb,text),public.nm_rpc(text,jsonb,text) from public,anon,authenticated;
grant execute on function nm_private.dispatch(text,jsonb,text),public.nm_rpc(text,jsonb,text) to anon,authenticated;
commit;
