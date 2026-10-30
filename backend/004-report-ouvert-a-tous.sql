-- V12.2 / V1.4.3 — appliqué en production le 30/10/2026 (migration Supabase v12_2_open_reschedule_skip_cancel).
-- Report, tour sauté et annulation d'une occurrence ouverts à tous (tablette associée, compte enfant compris).
-- La réouverture (correction) reste réservée aux adultes. Chaque action reste tracée dans nm_private.events
-- (auteur, appareil, état avant/après, motif) et apparaît dans les statistiques.
-- La définition précédente est sauvegardée dans nm_private.function_backups. Réexécution : échoue proprement si la cible a déjà changé.
create table if not exists nm_private.function_backups(name text not null, at timestamptz not null default now(), definition text not null);
alter table nm_private.function_backups enable row level security;
revoke all on nm_private.function_backups from public, anon, authenticated;
do $$
declare d text := pg_get_functiondef('nm_private.dispatch_v11(text,jsonb,text)'::regprocedure);
 old text := 'if p_action<>''complete'' and not isadmin then raise exception ''SCOPE_DENIED'';end if;';
 new text := 'if p_action=''reopen'' and not isadmin then raise exception ''SCOPE_DENIED'';end if; -- V12.2 : report, tour sauté et annulation ouverts à tous, tracés dans events';
begin
 if (select count(*) from regexp_matches(d, 'if p_action<>''complete'' and not isadmin then raise exception ''SCOPE_DENIED'';end if;', 'g')) <> 1 then raise exception 'PATCH_TARGET_NOT_FOUND'; end if;
 insert into nm_private.function_backups(name, definition) values ('nm_private.dispatch_v11 avant V12.2', d);
 execute replace(d, old, new);
end$$;
