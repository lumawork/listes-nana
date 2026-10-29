-- Lecture seule : aucun contenu de tâche, compte ou secret n'est retourné.
select
 to_regprocedure('public.mm_v9_bootstrap()') is not null as comptes_mes_missions,
 to_regprocedure('public.nm_rpc(text,jsonb,text)') is not null as moteur_commun,
 to_regprocedure('public.nm_legacy(text,jsonb)') is not null as reprise_v10,
 to_regprocedure('public.nm_push_claim()') is not null as rappels_moteur;

select version,name
from supabase_migrations.schema_migrations
where version in ('20261025111741','20261025112349','20261025135819')
order by version;

select schemaname,tablename,rowsecurity
from pg_tables where schemaname='nm_private' order by tablename;

select has_schema_privilege('anon','nm_private','USAGE') as usage_schema_anon,
       has_schema_privilege('authenticated','nm_private','USAGE') as usage_schema_authenticated;

-- USAGE est requis pour les fonctions internes autorisées ; il ne donne pas accès aux tables.
-- Ces deux compteurs doivent être nuls dans l'installation actuelle.
select
 (select count(*) from pg_tables t where schemaname='nm_private' and has_table_privilege('anon',format('%I.%I',schemaname,tablename),'SELECT,INSERT,UPDATE,DELETE')) as tables_directes_anon,
 (select count(*) from pg_tables t where schemaname='nm_private' and has_table_privilege('authenticated',format('%I.%I',schemaname,tablename),'SELECT,INSERT,UPDATE,DELETE')) as tables_directes_authenticated;
