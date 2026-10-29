begin;
create schema nm_private;
revoke all on schema nm_private from public,anon,authenticated;
create table nm_private.homes(family_id uuid primary key references mm_private.mm_families(id),config jsonb not null,revision bigint not null default 1);
create table nm_private.defs(id uuid primary key default gen_random_uuid(),family_id uuid not null references nm_private.homes,person text not null check(person in ('annabelle','papa','maman')),title text not null check(length(title) between 1 and 500),spec jsonb not null,next_due timestamptz,archived boolean not null default false,version bigint not null default 1,source_key text,unique(family_id,source_key));
create table nm_private.occ(id uuid primary key default gen_random_uuid(),def_id uuid not null references nm_private.defs,family_id uuid not null references nm_private.homes,person text not null,title text not null,spec jsonb not null,anchor timestamptz not null,original_due timestamptz not null,due timestamptz not null,original_end timestamptz not null,ends timestamptz not null,visible timestamptz not null,status text not null default 'open' check(status in ('open','done','skipped','cancelled')),completed timestamptz,version bigint not null default 1,unique(def_id,anchor));
create unique index nm_relative_open on nm_private.occ(def_id) where status='open' and spec->>'mode'='relative';
create index nm_occ_home on nm_private.occ(family_id,status,visible,due);
create table nm_private.events(id uuid primary key default gen_random_uuid(),family_id uuid not null,occ_id uuid,actor uuid,device uuid,kind text not null,before_data jsonb,after_data jsonb,reason text,at timestamptz not null default now());
create index nm_events_home on nm_private.events(family_id,at);
create table nm_private.requests(principal text not null,request_id uuid not null,fingerprint text not null,result jsonb not null,primary key(principal,request_id));
create table nm_private.grants(id uuid primary key default gen_random_uuid(),family_id uuid not null,person text not null,code_hash text not null,permissions jsonb not null default '{}',expires timestamptz not null,used boolean default false,revoked boolean default false);
create table nm_private.devices(id uuid primary key default gen_random_uuid(),grant_id uuid not null references nm_private.grants,token_hash text unique not null,label text not null,expires timestamptz not null,revoked boolean default false);
create table nm_private.attempts(grant_id uuid not null,at timestamptz default now());
create table nm_private.push_jobs(id uuid primary key default gen_random_uuid(),occ_id uuid not null references nm_private.occ,user_id uuid not null,subscription_id uuid not null,step int not null,lease uuid not null default gen_random_uuid(),sent_at timestamptz,status int,created_at timestamptz default now(),unique(occ_id,subscription_id,step));
do $$declare t text;begin foreach t in array array['homes','defs','occ','events','requests','grants','devices','attempts','push_jobs'] loop execute 'alter table nm_private.'||t||' enable row level security';execute 'revoke all on nm_private.'||t||' from public,anon,authenticated';end loop;end$$;
create function nm_private.hash(v text) returns text language sql immutable set search_path='' as $$select encode(sha256(convert_to(v,'UTF8')),'hex')$$;
create function nm_private.next_time(s jsonb,t timestamptz) returns timestamptz language plpgsql immutable set search_path='' as $$
declare n int:=coalesce((s->>'every')::int,1);u text:=coalesce(s->>'unit','days');begin
 if n<1 or n>365 then raise exception 'INVALID_SCHEDULE';end if;
 if u='minutes' then return t+make_interval(mins=>n);elsif u='hours' then return t+make_interval(hours=>n);elsif u='days' then return ((t at time zone 'Europe/Paris')+make_interval(days=>n)) at time zone 'Europe/Paris';elsif u='weeks' then return ((t at time zone 'Europe/Paris')+make_interval(days=>n*7)) at time zone 'Europe/Paris';else raise exception 'INVALID_SCHEDULE';end if;end$$;
create function nm_private.window(s jsonb,t timestamptz) returns jsonb language plpgsql immutable set search_path='' as $$
declare freq int;en timestamptz;vis timestamptz;d date:=(t at time zone 'Europe/Paris')::date;period text:=s->>'period';st time;et time;begin
 freq:=coalesce((s->>'every')::int,1)*case s->>'unit' when 'minutes' then 60 when 'hours' then 3600 when 'weeks' then 604800 else 86400 end;
 if period in ('morning','afternoon','evening') then
 st:=coalesce(nullif(s->>'periodStart','')::time,case period when 'morning' then time '06:00' when 'afternoon' then time '12:00' else time '18:00' end);et:=coalesce(nullif(s->>'periodEnd','')::time,case period when 'morning' then time '12:00' when 'afternoon' then time '18:00' else time '22:00' end);en:=((d+case when et<=st then 1 else 0 end)+et) at time zone 'Europe/Paris';vis:=t-interval '4 hours';
 elsif freq>=86400 or s->>'dueType'='day' then en:=((d+1)::timestamp) at time zone 'Europe/Paris';vis:=case when freq>86400 or s->>'dueType'='day' then ((t at time zone 'Europe/Paris')-interval '5 days') at time zone 'Europe/Paris' else t-interval '2 hours' end;
 else en:=least(t+interval '1 hour',case when s->>'mode'='fixed' then nm_private.next_time(s,t) else t+interval '1 hour' end);vis:=t-interval '2 hours';end if;
 return jsonb_build_object('ends',en,'visible',vis);end$$;
create function nm_private.add_occ(d nm_private.defs,t timestamptz) returns void language plpgsql set search_path='' as $$declare w jsonb;begin
 w:=nm_private.window(d.spec,t);insert into nm_private.occ(def_id,family_id,person,title,spec,anchor,original_due,due,original_end,ends,visible) values(d.id,d.family_id,d.person,d.title,d.spec,t,t,t,(w->>'ends')::timestamptz,(w->>'ends')::timestamptz,greatest((w->>'visible')::timestamptz,now())) on conflict(def_id,anchor) do nothing;end$$;
create function nm_private.schedule_valid(s jsonb) returns boolean language plpgsql immutable set search_path='' as $$begin
 if jsonb_typeof(s) is distinct from 'object' or coalesce(s->>'mode','') not in ('fixed','relative','once') or coalesce((s->>'every')::int,0) not between 1 and 365 or coalesce(s->>'unit','') not in ('minutes','hours','days','weeks') then return false;end if;
 if coalesce(s->>'period','')<>'' and (s->>'period' not in ('morning','afternoon','evening') or s->>'unit' not in ('days','weeks')) then return false;end if;
 if s?'days' and (jsonb_typeof(s->'days') is distinct from 'array' or exists(select 1 from jsonb_array_elements(s->'days')v where v::text !~ '^[0-6]$')) then return false;end if;
 if coalesce((s->>'reminderDelay')::int,15) not in (5,10,15,30,60) or coalesce((s->>'reminderCount')::int,2) not between 0 and 3 then return false;end if;
 if exists(select 1 from jsonb_each_text(s)k where k.key in ('periodStart','periodEnd','reminderTime') and coalesce(k.value,'')<>'' and k.value !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then return false;end if;
 return true;exception when others then return false;end$$;
create function nm_private.schedule_active(s jsonb,t timestamptz) returns boolean language sql immutable set search_path='' as $$
 select (nullif(s->>'pausedUntil','') is null or (t at time zone 'Europe/Paris')::date>(s->>'pausedUntil')::date)
 and not exists(select 1 from jsonb_array_elements(coalesce(s->'pausedWindows','[]'))w where t>=(w->>'from')::timestamptz and t<(w->>'to')::timestamptz)
$$;
create function nm_private.is_quiet(cfg jsonb,t timestamptz) returns boolean language sql immutable set search_path='' as $$
 select case when coalesce(cfg->>'quietStart','22:00')=coalesce(cfg->>'quietEnd','07:00') then false
 when coalesce(cfg->>'quietStart','22:00')<coalesce(cfg->>'quietEnd','07:00') then to_char(t at time zone 'Europe/Paris','HH24:MI')>=coalesce(cfg->>'quietStart','22:00') and to_char(t at time zone 'Europe/Paris','HH24:MI')<coalesce(cfg->>'quietEnd','07:00')
 else to_char(t at time zone 'Europe/Paris','HH24:MI')>=coalesce(cfg->>'quietStart','22:00') or to_char(t at time zone 'Europe/Paris','HH24:MI')<coalesce(cfg->>'quietEnd','07:00') end
$$;
revoke all on function nm_private.schedule_valid(jsonb),nm_private.schedule_active(jsonb,timestamptz),nm_private.is_quiet(jsonb,timestamptz) from public,anon,authenticated;

create function nm_private.generate(f uuid) returns void language plpgsql set search_path='' as $$
declare d nm_private.defs;t timestamptz;lim timestamptz;n int;cnt bigint;changed boolean:=false;begin
 for d in select * from nm_private.defs where family_id=f and not archived and next_due is not null for update loop
 if coalesce((d.spec->>'paused')::boolean,false) then continue;end if;
 t:=d.next_due;n:=0;lim:=now()+case when d.spec->>'unit' in ('hours','minutes') then interval '2 days' else interval '35 days' end;
 while t<=lim and n<2000 loop
 if d.spec->>'mode' in ('relative','once') and not nm_private.schedule_active(d.spec,t) then t:=((t at time zone 'Europe/Paris')+interval '1 day') at time zone 'Europe/Paris';n:=n+1;continue;end if;
 if d.spec->>'mode'='relative' and exists(select 1 from nm_private.occ where def_id=d.id and status='open') then exit;end if;
 if nm_private.schedule_active(d.spec,t) and (d.spec->>'mode' in ('relative','once') or not(d.spec?'days') or d.spec->'days' @> to_jsonb(extract(dow from t at time zone 'Europe/Paris')::int)) then
 perform nm_private.add_occ(d,t);changed:=true;end if;
 n:=n+1;
 if d.spec->>'mode' in ('relative','once') then t:=null;exit;end if;
 t:=nm_private.next_time(d.spec,t);
 end loop;
 update nm_private.defs set next_due=t where id=d.id;
 end loop;
 if changed then update nm_private.homes set revision=revision+1 where family_id=f;end if;end$$;
create function nm_private.dispatch(p_action text,p_data jsonb,p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();f uuid;kind text;isadmin boolean:=false;personscope text;device uuid;vprincipal text;h nm_private.homes;cfg jsonb;outv jsonb;oldr jsonb;fp text;requestid uuid;d nm_private.defs;o nm_private.occ;spec jsonb;t timestamptz;w jsonb;grantrow nm_private.grants;extra_permissions jsonb:='{}';code text;token text;g uuid;x jsonb;n int;oldjson jsonb;rowsjson jsonb;fromdate date;to_date date;
begin
 if p_data is null or octet_length(p_data::text)>1500000 then raise exception 'INVALID_REQUEST';end if;
 if p_action='pair' then
 if coalesce(p_data->>'identifier','')='' or coalesce(p_data->>'code','')='' then raise exception 'PAIR_DENIED';end if;g:=(p_data->>'identifier')::uuid;select * into grantrow from nm_private.grants where id=g for update;
 if grantrow.id is null then raise exception 'PAIR_DENIED';end if;
 if (select count(*) from nm_private.attempts where grant_id=g and at>now()-interval '15 minutes')>=20 then raise exception 'RATE_LIMITED';end if;
 insert into nm_private.attempts(grant_id) values(g);
 if grantrow.used or grantrow.revoked or grantrow.expires<now() or grantrow.code_hash<>nm_private.hash(p_data->>'code') then return jsonb_build_object('error','PAIR_DENIED');end if;
 token:=gen_random_uuid()::text||gen_random_uuid()::text;
 insert into nm_private.devices(grant_id,token_hash,label,expires) values(g,nm_private.hash(token),left(coalesce(p_data->>'label','Appareil familial'),80),now()+interval '30 days') returning id into device;
 update nm_private.grants set used=true where id=g;return jsonb_build_object('token',token,'device',device);
 end if;
 if p_token is not null and p_token<>'' then
 select a.family_id,a.person,b.id,a.permissions into f,personscope,device,extra_permissions from nm_private.devices b join nm_private.grants a on a.id=b.grant_id where b.token_hash=nm_private.hash(p_token) and not b.revoked and not a.revoked and b.expires>now();
 if f is null then raise exception 'ACCESS_REVOKED';end if;if personscope='home' then personscope:=null;end if;vprincipal:='device:'||device::text;
 else
 if uid is null then raise exception 'AUTH_REQUIRED';end if;
 select family_id,p.kind into f,kind from mm_private.mm_profiles p where user_id=uid;
 if f is null then raise exception 'PROFILE_REQUIRED';end if;isadmin:=kind='adult';vprincipal:='user:'||uid::text;
 end if;
 if not exists(select 1 from nm_private.homes where family_id=f) then
 if not isadmin then raise exception 'SETUP_REQUIRED';end if;
 cfg:=jsonb_build_object('people',jsonb_build_array(jsonb_build_object('id','annabelle','name','Annabelle','avatar',0),jsonb_build_object('id','papa','name','Papa','avatar',1),jsonb_build_object('id','maman','name','Maman','avatar',2,'userId',uid)),'rules',jsonb_build_array('Je range mes affaires','Je nettoie derrière moi','Je respecte les espaces communs','Je demande avant d’emprunter','Je prends soin des animaux'),'rituals',jsonb_build_array(jsonb_build_object('id','evening','title','Le rituel du soir','text','On range ses affaires et on prépare demain.','time','19:00','minutes',10,'enabled',false)),'shortcuts','[]'::jsonb,'idleSeconds',120,'cameraUrl','','quietStart','22:00','quietEnd','07:00','tone','fun','schemaVersion',1);
 insert into nm_private.homes values(f,cfg,1) on conflict do nothing;
 end if;
 select * into h from nm_private.homes where family_id=f for update;cfg:=h.config;
 if kind='child' then personscope:='annabelle';end if;
 if p_action='revision' then return jsonb_build_object('revision',h.revision);end if;
 if p_action in ('snapshot','export','history') then
 if p_action='export' and device is not null then raise exception 'SCOPE_DENIED';end if;if p_action='export' and (select count(*) from nm_private.occ where family_id=f and (personscope is null or person=personscope))>20000 then raise exception 'EXPORT_REQUIRES_PAGINATION';end if;
 perform nm_private.generate(f);select * into h from nm_private.homes where family_id=f;
 fromdate:=coalesce((p_data->>'from')::date,((now() at time zone 'Europe/Paris')::date-29));to_date:=coalesce((p_data->>'to')::date,((now() at time zone 'Europe/Paris')::date+1));
 select coalesce(jsonb_agg(to_jsonb(q) order by q.due),'[]') into rowsjson from (select * from nm_private.occ where family_id=f and (personscope is null or person=personscope) and (status='open' or p_action='export' or (original_due at time zone 'Europe/Paris')::date between fromdate and to_date) order by due limit 20000)q;
 outv:=jsonb_build_object('schemaVersion',1,'config',h.config,'revision',h.revision,'serverNow',now(),'personScope',personscope,'admin',isadmin,'userId',uid,'deviceId',device,'occurrences',rowsjson,'definitions',coalesce((select jsonb_agg(to_jsonb(a)) from nm_private.defs a where a.family_id=f and (personscope is null or a.person=personscope)),'[]'));
 if isadmin then outv:=outv||jsonb_build_object('profiles',coalesce((select jsonb_agg(jsonb_build_object('id',p.user_id,'name',p.display_name,'kind',p.kind)) from mm_private.mm_profiles p where p.family_id=f),'[]'),'grants',coalesce((select jsonb_agg(jsonb_build_object('id',id,'person',person,'expires',expires,'revoked',revoked,'used',used)) from nm_private.grants where family_id=f),'[]'));end if;
 if p_action='export' then outv:=outv||jsonb_build_object('legacySnapshots',coalesce((select jsonb_agg(to_jsonb(z)) from nm_private.legacy_snapshots z where z.family_id=f and (personscope is null or exists(select 1 from nm_private.migration_links m where m.snapshot_id=z.id and m.person=personscope))),'[]'));end if;
 if p_action in ('export','history') then outv:=outv||jsonb_build_object('events',coalesce((select jsonb_agg(to_jsonb(e) order by e.at desc) from nm_private.events e where e.family_id=f and (personscope is null or exists(select 1 from nm_private.occ z where z.id=e.occ_id and z.person=personscope))),'[]'));end if;
 -- Restrict a device/child's config to the allowed person and exclude secondary secrets.
 if personscope is not null then outv:=jsonb_set(outv,'{config}',h.config||jsonb_build_object('people',(select jsonb_agg(z) from jsonb_array_elements(h.config->'people')z where z->>'id'=personscope),'shortcuts','[]'::jsonb,'cameraUrl',''));end if;
 if device is not null then if personscope is not null or not coalesce((extra_permissions->>'camera')::boolean,false) then outv:=jsonb_set(outv,'{config,cameraUrl}','""'::jsonb);end if;if personscope is not null or not coalesce((extra_permissions->>'shortcuts')::boolean,false) then outv:=jsonb_set(outv,'{config,shortcuts}','[]'::jsonb);end if;end if;
 return outv;
 end if;
 if p_action='public_key' then return to_jsonb(public.mm_push_public_key());end if;
 if p_action='subscribe' then if uid is null then raise exception 'AUTH_REQUIRED';end if;perform public.mm_push_subscribe(p_data->'subscription');return '{}'::jsonb;end if;
 if p_action='push_authorize' then return to_jsonb(exists(select 1 from nm_private.push_jobs j join nm_private.occ z on z.id=j.occ_id where j.id=(p_data->>'id')::uuid and j.user_id=uid and z.status='open'));end if;
 requestid:=(p_data->>'requestId')::uuid;if requestid is null then raise exception 'REQUEST_REQUIRED';end if;
 fp:=nm_private.hash(p_action||p_data::text);perform pg_advisory_xact_lock(hashtext(vprincipal||requestid::text));
 select r.result into oldr from nm_private.requests r where r.principal=vprincipal and r.request_id=requestid;
 if found then if (select fingerprint from nm_private.requests r where r.principal=vprincipal and r.request_id=requestid)<>fp then raise exception 'REQUEST_REUSED';end if;return oldr;end if;
 if p_action in ('config','create','edit','archive','grant','revoke','import','avatar') then
 if not isadmin and not(kind='child' and p_action in ('create','edit','archive')) and p_action<>'avatar' then raise exception 'SCOPE_DENIED';end if;
 end if;
 if p_action='config' then
 if (p_data->>'version')::bigint is distinct from h.revision then raise exception 'VERSION_CONFLICT';end if;
 cfg:=p_data->'config';if cfg is null then raise exception 'INVALID_CONFIG';end if;if jsonb_typeof(cfg)<>'object' or jsonb_array_length(cfg->'people')<>3 or octet_length(cfg::text)>1200000 or (cfg->>'idleSeconds')::int not between 30 and 600 then raise exception 'INVALID_CONFIG';end if;
 if exists(select 1 from jsonb_array_elements(cfg->'people')z where z->>'id' not in ('annabelle','papa','maman') or length(coalesce(z->>'image',''))>275000 or (coalesce(z->>'image','')<>'' and z->>'image' !~ '^data:image/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$')) or (select count(distinct z->>'id') from jsonb_array_elements(cfg->'people')z)<>3 then raise exception 'INVALID_CONFIG';end if;
 if exists(select 1 from jsonb_array_elements(cfg->'shortcuts')z where z->>'type' not in ('url','android') or z->>'target' !~ '^(https://|intent:)') then raise exception 'INVALID_SHORTCUT';end if;
 if exists(select 1 from jsonb_array_elements(cfg->'people')z where nullif(z->>'userId','') is not null and not exists(select 1 from mm_private.mm_profiles p where p.user_id=(z->>'userId')::uuid and p.family_id=f)) then raise exception 'INVALID_RECIPIENT';end if;
 if coalesce(cfg->>'cameraUrl','')<>'' and cfg->>'cameraUrl' !~ '^https://' then raise exception 'INVALID_CAMERA';end if;
 update nm_private.homes set config=cfg where family_id=f;
 elsif p_action='avatar' then
 if not isadmin and (personscope is distinct from p_data->>'person' or device is not null) then raise exception 'SCOPE_DENIED';end if;
 if length(coalesce(p_data->>'image',''))>275000 or (coalesce(p_data->>'image','')<>'' and p_data->>'image' !~ '^data:image/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$') then raise exception 'INVALID_IMAGE';end if;
 update nm_private.homes set config=jsonb_set(config,'{people}',(select jsonb_agg(case when z->>'id'=p_data->>'person' then z||jsonb_build_object('avatar',greatest(0,least(5,coalesce((p_data->>'avatar')::int,0))))||jsonb_build_object('image',coalesce(p_data->>'image','')) else z end) from jsonb_array_elements(config->'people')z)) where family_id=f;
 elsif p_action in ('grant','revoke') then
 if p_action='grant' then
 if p_data->>'person' not in ('annabelle','papa','maman','home') then raise exception 'INVALID_PERSON';end if;
 code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
 insert into nm_private.grants(family_id,person,code_hash,permissions,expires) values(f,p_data->>'person',nm_private.hash(code),case when p_data->>'person'='home' then jsonb_build_object('camera',coalesce((p_data->'permissions'->>'camera')::boolean,false),'shortcuts',coalesce((p_data->'permissions'->>'shortcuts')::boolean,false)) else '{}'::jsonb end,now()+interval '24 hours') returning id into g;outv:=jsonb_build_object('identifier',g,'code',code);
 else update nm_private.grants set revoked=true where id=(p_data->>'id')::uuid and family_id=f;end if;
 elsif p_action in ('create','import') then
 if p_action='import' and p_data?'legacy' then insert into nm_private.legacy_snapshots(family_id,source_hash,payload) values(f,nm_private.hash((p_data->'legacy')::text),p_data->'legacy') on conflict(family_id,source_hash) do nothing;end if;
 if p_action='import' and not coalesce((p_data->>'oldRemindersDisabled')::boolean,false) then raise exception 'MIGRATION_ACK_REQUIRED';end if;
 for x in select value from jsonb_array_elements(case when p_action='import' then p_data->'tasks' else jsonb_build_array(p_data) end) loop
 if not isadmin and x->>'person' is distinct from personscope then raise exception 'SCOPE_DENIED';end if;spec:=x->'spec';if not nm_private.schedule_valid(spec) then raise exception 'INVALID_SCHEDULE';end if;if spec->>'mode' not in ('fixed','relative','once') or coalesce((spec->>'every')::int,0) not between 1 and 365 or spec->>'unit' not in ('minutes','hours','days','weeks') or x->>'person' not in ('annabelle','papa','maman') then raise exception 'INVALID_SCHEDULE';end if;
 t:=case when (spec->>'firstDue') ~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then (spec->>'firstDue')::timestamptz else (spec->>'firstDue')::timestamp at time zone 'Europe/Paris' end;
 if spec->>'period' in ('morning','afternoon','evening') then t:=((t at time zone 'Europe/Paris')::date+coalesce(nullif(spec->>'periodStart','')::time,case spec->>'period' when 'morning' then time '06:00' when 'afternoon' then time '12:00' else time '18:00' end)) at time zone 'Europe/Paris';end if;
 if t is null then raise exception 'FIRST_DUE_REQUIRED';end if;
 insert into nm_private.defs(family_id,person,title,spec,next_due,source_key) values(f,x->>'person',trim(x->>'title'),spec,t,x->>'sourceKey') on conflict(family_id,source_key) do nothing;
 end loop;perform nm_private.generate(f);
 elsif p_action in ('edit','archive') then
 select * into d from nm_private.defs where id=(p_data->>'id')::uuid and family_id=f for update;if d.id is null then raise exception 'NOT_FOUND';end if;if not isadmin and d.person is distinct from personscope then raise exception 'SCOPE_DENIED';end if;
 if (p_data->>'version')::bigint is distinct from d.version then raise exception 'VERSION_CONFLICT';end if;
 if p_action='archive' then update nm_private.defs set archived=true,version=version+1 where id=d.id;update nm_private.occ set status='cancelled',version=version+1 where def_id=d.id and status='open' and original_due>=now();
 else
 spec:=d.spec||coalesce(p_data->'spec','{}');if not nm_private.schedule_valid(spec) then raise exception 'INVALID_SCHEDULE';end if;
 if p_data->'spec'?'paused' then
 if coalesce((p_data->'spec'->>'paused')::boolean,false) then p_data:=jsonb_set(p_data,'{spec,pausedAt}',to_jsonb(now()));
 elsif coalesce((d.spec->>'paused')::boolean,false) then
 p_data:=jsonb_set(p_data,'{spec,pausedWindows}',coalesce(d.spec->'pausedWindows','[]')||jsonb_build_array(jsonb_build_object('from',d.spec->>'pausedAt','to',now())));
 update nm_private.occ set status='cancelled',version=version+1 where def_id=d.id and status='open' and original_due>=coalesce((d.spec->>'pausedAt')::timestamptz,now()) and original_due<now();
 end if;spec:=d.spec||coalesce(p_data->'spec','{}');end if;
 if coalesce((p_data->>'replaceSchedule')::boolean,false) then
 if spec->>'mode' not in ('fixed','relative','once') or coalesce((spec->>'every')::int,0) not between 1 and 365 or spec->>'unit' not in ('minutes','hours','days','weeks') then raise exception 'INVALID_SCHEDULE';end if;
 t:=(spec->>'firstDue')::timestamp at time zone 'Europe/Paris';if t<now() or t is null then raise exception 'INVALID_DUE';end if;
 if spec->>'period' in ('morning','afternoon','evening') then t:=((t at time zone 'Europe/Paris')::date+coalesce(nullif(spec->>'periodStart','')::time,case spec->>'period' when 'morning' then time '06:00' when 'afternoon' then time '12:00' else time '18:00' end)) at time zone 'Europe/Paris';end if;
 if spec->>'mode'='relative' and exists(select 1 from nm_private.occ where def_id=d.id and status='open' and original_due<now()) then raise exception 'RESOLVE_OPEN_OCCURRENCE';end if;
 insert into nm_private.events(family_id,occ_id,actor,device,kind,before_data,reason) select f,z.id,uid,device,'schedule_replaced',to_jsonb(z),'Occurrences futures remplacées par un nouveau calendrier' from nm_private.occ z where z.def_id=d.id and z.status='open' and z.original_due>=now();
 update nm_private.occ set status='cancelled',version=version+1 where def_id=d.id and status='open' and original_due>=now();
 if t<now() then raise exception 'INVALID_DUE';end if;update nm_private.defs set archived=true,version=version+1 where id=d.id;insert into nm_private.defs(family_id,person,title,spec,next_due) values(f,d.person,coalesce(nullif(trim(p_data->>'title'),''),d.title),spec,t);
 perform nm_private.generate(f);
 else update nm_private.defs set title=coalesce(nullif(trim(p_data->>'title'),''),title),spec=nm_private.defs.spec||coalesce(p_data->'spec','{}'),version=version+1 where id=d.id;
 update nm_private.occ set title=coalesce(nullif(trim(p_data->>'title'),''),title),spec=nm_private.occ.spec||coalesce(p_data->'spec','{}'),version=version+1 where def_id=d.id and status='open' and original_due>=now();
 end if;end if;
 elsif p_action in ('complete','reschedule','skip','cancel','reopen') then
 select * into o from nm_private.occ where id=(p_data->>'id')::uuid and family_id=f and (personscope is null or person=personscope) for update;
 if o.id is null then raise exception 'SCOPE_DENIED';end if;
 if p_action<>'complete' and not isadmin then raise exception 'SCOPE_DENIED';end if;
 if o.status='done' and p_action='complete' then return jsonb_build_object('alreadyApplied',true);end if;
 if (p_data->>'version')::bigint is distinct from o.version then raise exception 'VERSION_CONFLICT';end if;
 oldjson:=to_jsonb(o);
 if p_action='complete' then
 if o.status<>'open' then raise exception 'ALREADY_TERMINAL';end if;if o.visible>now() then raise exception 'OCCURRENCE_NOT_VISIBLE';end if;
 update nm_private.occ set status='done',completed=now(),version=version+1 where id=o.id;
 select * into d from nm_private.defs where id=o.def_id for update;
 if d.spec->>'mode'='relative' and not d.archived then t:=nm_private.next_time(d.spec,now());if d.spec->>'period' in ('morning','afternoon','evening') then t:=((t at time zone 'Europe/Paris')::date+coalesce(nullif(d.spec->>'periodStart','')::time,case d.spec->>'period' when 'morning' then time '06:00' when 'afternoon' then time '12:00' else time '18:00' end)) at time zone 'Europe/Paris';end if;update nm_private.defs set next_due=t where id=d.id;perform nm_private.generate(f);end if;
 elsif p_action='reschedule' then
 if o.status<>'open' then raise exception 'ALREADY_TERMINAL';end if;
 t:=(p_data->>'due')::timestamp at time zone 'Europe/Paris';if t<=now() then raise exception 'INVALID_DUE';end if;w:=nm_private.window(o.spec,t);
 update nm_private.occ set due=t,ends=(w->>'ends')::timestamptz,visible=greatest(now(),(w->>'visible')::timestamptz),version=version+1 where id=o.id;
 elsif p_action='reopen' then
 if o.status='open' then raise exception 'ALREADY_OPEN';end if;
 if o.spec->>'mode'='relative' then
 if exists(select 1 from nm_private.occ where def_id=o.def_id and anchor>o.anchor and (status<>'open' or version>1)) then raise exception 'RELATIVE_CONFLICT';end if;
 update nm_private.occ set status='cancelled',version=version+1 where def_id=o.def_id and anchor>o.anchor and status='open';update nm_private.defs set next_due=null where id=o.def_id;end if;
 update nm_private.occ set status='open',completed=null,version=version+1 where id=o.id;
 else
 if o.status<>'open' then raise exception 'ALREADY_TERMINAL';end if;
 if p_action='skip' and o.spec->>'mode'='relative' and nullif(p_data->>'nextDue','') is null then raise exception 'NEXT_DUE_REQUIRED';end if;
 update nm_private.occ set status=case when p_action='skip' then 'skipped' else 'cancelled' end,version=version+1 where id=o.id;
 if p_action='skip' and o.spec->>'mode'='relative' then t:=(p_data->>'nextDue')::timestamp at time zone 'Europe/Paris';if t<=now() then raise exception 'INVALID_DUE';end if;update nm_private.defs set next_due=t where id=o.def_id;perform nm_private.generate(f);end if;
 end if;
 insert into nm_private.events(family_id,occ_id,actor,device,kind,before_data,after_data,reason) select f,o.id,uid,device,p_action,oldjson,to_jsonb(z),left(p_data->>'reason',500) from nm_private.occ z where z.id=o.id;
 else raise exception 'UNKNOWN_ACTION';end if;
 if p_action in ('config','avatar','create','import','edit','archive','grant','revoke') then insert into nm_private.events(family_id,actor,device,kind,reason) values(f,uid,device,p_action,'Configuration ou accès modifié ; aucune donnée sensible dans le journal');end if;
 update nm_private.homes set revision=revision+1 where family_id=f returning revision into n;
 outv:=coalesce(outv,'{}'::jsonb)||jsonb_build_object('ok',true,'revision',n);
 insert into nm_private.requests values(vprincipal,requestid,fp,outv);return outv;
end$$;
-- Explicit argument names and variables avoid unqualified column ambiguity.
create function public.nm_rpc(p_action text,p_data jsonb default '{}',p_token text default null) returns jsonb language sql security invoker set search_path='' as $$select nm_private.dispatch(p_action,p_data,p_token)$$;
revoke all on all functions in schema nm_private from public,anon,authenticated;
grant usage on schema nm_private to anon,authenticated;
grant execute on function nm_private.dispatch(text,jsonb,text) to anon,authenticated;
revoke all on function public.nm_rpc(text,jsonb,text) from public;
grant execute on function public.nm_rpc(text,jsonb,text) to anon,authenticated;
-- Additive V1 storage and service-only reminders. No changes to V10 payloads.
create table nm_private.legacy_snapshots(id uuid primary key default gen_random_uuid(),family_id uuid not null references nm_private.homes,source_hash text not null,payload jsonb not null,imported_at timestamptz default now(),unique(family_id,source_hash));
alter table nm_private.legacy_snapshots enable row level security;revoke all on nm_private.legacy_snapshots from public,anon,authenticated;
alter table nm_private.push_jobs add column attempts int not null default 0;
alter table nm_private.push_jobs add column retry_at timestamptz default now();
create function nm_private.push_claim() returns jsonb language plpgsql security definer set search_path='' as $$
declare f uuid;j record;outv jsonb:='[]';newlease uuid;begin
 for f in select family_id from nm_private.homes order by family_id for update loop perform nm_private.generate(f);end loop;
 insert into nm_private.push_jobs(occ_id,user_id,subscription_id,step)
 select o.id,(p->>'userId')::uuid,s.id,step
 from nm_private.occ o join nm_private.defs d on d.id=o.def_id join nm_private.homes h on h.family_id=o.family_id
 cross join lateral jsonb_array_elements(h.config->'people')p
 join mm_private.mm_push_subscriptions s on s.user_id=(p->>'userId')::uuid
 cross join lateral generate_series(0,coalesce((o.spec->>'reminderCount')::int,2))step
 cross join lateral (select case when nullif(o.spec->>'reminderTime','') is null then o.due else ((o.due at time zone 'Europe/Paris')::date+(o.spec->>'reminderTime')::time) at time zone 'Europe/Paris' end+step*make_interval(mins=>coalesce((o.spec->>'reminderDelay')::int,15)) as fire)clock
 where o.status='open' and not d.archived and not coalesce((d.spec->>'paused')::boolean,false) and o.person=p->>'id' and coalesce((o.spec->>'reminder')::boolean,false)
 and nullif(p->>'userId','') is not null and clock.fire<=now() and clock.fire>now()-interval '5 minutes'
 and not nm_private.is_quiet(h.config,now())
 on conflict(occ_id,subscription_id,step) do nothing;
 for j in select a.*,s.subscription from nm_private.push_jobs a join mm_private.mm_push_subscriptions s on s.id=a.subscription_id where a.sent_at is null and a.retry_at<=now() and a.attempts<3 and a.created_at>now()-interval '10 minutes' order by a.created_at limit 50 for update of a skip locked loop
 newlease:=gen_random_uuid();update nm_private.push_jobs set lease=newlease,attempts=attempts+1,retry_at=now()+interval '1 minute' where id=j.id;
 outv:=outv||jsonb_build_array(jsonb_build_object('id',j.id,'lease',newlease,'subscription',j.subscription,'userId',j.user_id));end loop;return outv;
end$$;
create function nm_private.push_can_send(p_id uuid,p_lease uuid) returns boolean language sql security definer set search_path='' as $$
select exists(select 1 from nm_private.push_jobs j join nm_private.occ o on o.id=j.occ_id join nm_private.defs d on d.id=o.def_id join nm_private.homes h on h.family_id=o.family_id join mm_private.mm_push_subscriptions s on s.id=j.subscription_id where j.id=p_id and j.lease=p_lease and j.sent_at is null and o.status='open' and not nm_private.is_quiet(h.config,now()) and not d.archived and not coalesce((d.spec->>'paused')::boolean,false) and exists(select 1 from jsonb_array_elements(h.config->'people')p where p->>'id'=o.person and p->>'userId'=j.user_id::text))$$;
create function nm_private.push_ack(p_id uuid,p_lease uuid,p_status int) returns void language plpgsql security definer set search_path='' as $$begin update nm_private.push_jobs set status=p_status,sent_at=case when p_status between 200 and 499 then now() else null end where id=p_id and lease=p_lease;end$$;
create function nm_private.push_tick() returns bigint language plpgsql security definer set search_path='' as $$declare rid bigint;begin
 if not exists(select 1 from nm_private.occ where status='open' and (spec->>'reminder')::boolean=true) then return null;end if;
 select net.http_post(url:='https://rfytfypsbasxauekaxba.supabase.co/functions/v1/maison-reminders',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='mm_push_cron_token')),body:='{}'::jsonb,timeout_milliseconds:=20000) into rid;return rid;end$$;
create function public.nm_push_claim() returns jsonb language sql security invoker set search_path='' as $$select nm_private.push_claim()$$;
create function public.nm_push_can_send(p_id uuid,p_lease uuid) returns boolean language sql security invoker set search_path='' as $$select nm_private.push_can_send(p_id,p_lease)$$;
create function public.nm_push_ack(p_id uuid,p_lease uuid,p_status int) returns void language sql security invoker set search_path='' as $$select nm_private.push_ack(p_id,p_lease,p_status)$$;
revoke all on all functions in schema nm_private from public,anon,authenticated;
grant execute on function nm_private.dispatch(text,jsonb,text) to anon,authenticated;
revoke all on function public.nm_push_claim(),public.nm_push_can_send(uuid,uuid),public.nm_push_ack(uuid,uuid,int) from public,anon,authenticated;
grant usage on schema nm_private to service_role;
grant execute on function nm_private.push_claim(),nm_private.push_can_send(uuid,uuid),nm_private.push_ack(uuid,uuid,int),public.nm_push_claim(),public.nm_push_can_send(uuid,uuid),public.nm_push_ack(uuid,uuid,int) to service_role;
commit;
