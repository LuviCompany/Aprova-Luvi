-- Aprova Luvi — verificação da migration 17 (membros da equipe). SOMENTE LEITURA: cole no SQL Editor e clique em Run.
-- Rode ANTES e DEPOIS da migration 17 (20261121120000_team_members).
--
-- Resultado: uma tabela com bloco, tipo, verificacao e valor.
--   tipo = violacao  -> contagem; DEPOIS da migration, todas precisam ser 0.
--   tipo = impressao -> resumo (md5) do estado; precisa ser IDÊNTICO antes e depois (prova que nada indevido mudou).
--
-- ANTES da migration: bloco 1 = 3 (as três funções ainda não existem) e os blocos 2 a 8 = 0.
-- DEPOIS da migration: blocos 1 a 8 = 0. As impressões dos blocos 9 a 12 precisam ser iguais às de antes.
-- Se algo divergir, pare e traga o resultado: não rode a migration de novo nem conceda privilégios à mão.

with fn as (
  select p.oid, n.nspname || '.' || p.proname as name, p.prosecdef, p.proconfig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where (n.nspname, p.proname) in (('public', 'add_team_member'), ('public', 'reserve_team_invite_resend'), ('app', 'write_org_audit'))
)
select 1 as bloco, 'violacao' as tipo, 'funções da migration 17 ausentes (esperadas: 3)' as verificacao,
  (3 - (select count(*) from fn))::text as valor
union all
select 2, 'violacao', 'funções da migration 17 sem SECURITY DEFINER ou sem search_path vazio',
  (select count(*) from fn where not prosecdef or not coalesce(proconfig @> array['search_path=""'], false))::text
union all
select 3, 'violacao', 'funções da migration 17 executáveis pelo anônimo ou pelo service_role (devem ser nenhum)',
  (select count(*) from fn cross join (values ('anon'), ('service_role')) r(rolname) where has_function_privilege(r.rolname, fn.oid, 'EXECUTE'))::text
union all
select 4, 'violacao', 'add_team_member ou reserve_team_invite_resend NÃO executáveis pelo authenticated (devem ser)',
  (select count(*) from fn where name like 'public.%' and not has_function_privilege('authenticated', oid, 'EXECUTE'))::text
union all
select 5, 'violacao', 'app.write_org_audit (interna) executável pelo authenticated (deve ser nenhum)',
  (select count(*) from fn where name = 'app.write_org_audit' and has_function_privilege('authenticated', oid, 'EXECUTE'))::text
union all
select 6, 'violacao', 'authenticated com INSERT em profiles ou UPDATE em role, organization_id, active, email ou id (devem ser nenhum)',
  (select count(*) from (values ('INSERT'), ('UPDATE')) p(priv)
    cross join (values ('id'), ('organization_id'), ('role'), ('active'), ('email'), ('created_at')) c(col)
    where has_column_privilege('authenticated', 'public.profiles', c.col, p.priv))::text
union all
select 7, 'violacao', 'perfis com papel fora de admin, designer, atendimento e cliente, ou sem organização',
  (select count(*) from public.profiles where role::text not in ('admin', 'designer', 'atendimento', 'cliente') or organization_id is null)::text
union all
select 8, 'violacao', 'eventos de auditoria de membros da equipe com nome, e-mail, token, senha ou link no metadata',
  (select count(*) from public.audit_events
    where action like 'team_member.%' and metadata ?| array['name', 'email', 'full_name', 'token', 'token_hash', 'password', 'senha', 'link', 'url'])::text
union all
select 9, 'impressao', 'md5: privilégios de TABELA de anon, authenticated e service_role (public)',
  coalesce(md5(string_agg(grantee || ':' || table_name || ':' || privilege_type, ',' order by grantee, table_name, privilege_type)), '-')
  from information_schema.role_table_grants where grantee in ('anon', 'authenticated', 'service_role') and table_schema = 'public'
union all
select 10, 'impressao', 'md5: privilégios de COLUNA de anon, authenticated e service_role (public)',
  coalesce(md5(string_agg(grantee || ':' || table_name || ':' || column_name || ':' || privilege_type, ',' order by grantee, table_name, column_name, privilege_type)), '-')
  from information_schema.role_column_grants where grantee in ('anon', 'authenticated', 'service_role') and table_schema = 'public'
union all
select 11, 'impressao', 'md5: políticas RLS (public, storage e app)',
  coalesce(md5(string_agg(schemaname || '.' || tablename || ':' || policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), '|' order by schemaname, tablename, policyname)), '-')
  from pg_policies where schemaname in ('public', 'storage', 'app')
union all
select 12, 'impressao', 'md5: gatilhos do usuário (public) e perfis existentes',
  coalesce(md5(string_agg(c.relname || ':' || t.tgname, ',' order by c.relname, t.tgname)), '-') || ' / ' || (select count(*) from public.profiles)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
order by 1;
