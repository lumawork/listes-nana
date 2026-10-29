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
