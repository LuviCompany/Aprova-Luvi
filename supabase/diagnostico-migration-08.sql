-- Aprova Luvi — DIAGNÓSTICO da migration 08 (somente leitura, não altera nada).
--
-- Use quando a migration 20261103120300_audit_clients_projects_approvers.sql falhou com
-- "function audit_row_change already exists with same argument types" (ou para confirmar o estado
-- do banco depois dela). Cole TUDO no SQL Editor e clique em Run: o resultado é UMA tabela
-- (item, esperado, encontrado, situacao); a última linha, VEREDITO, diz o que fazer.
--
-- md5 do corpo de app.audit_row_change():
--   migration 08 (20261103120300): f86ee29a3a242c30d6500380cf46df2a
--   migration 10 (20261104120100): f69362fbd696f1dcbf540d1e3d48f1a4  (versão que cobre materiais)

with fn as (
  -- O md5 é calculado SEM o caractere CR: o editor do navegador pode gravar o texto com quebras CRLF em vez de LF,
  -- o que muda o md5 bruto mas não a lógica da função (veja diagnostico-audit-row-change.sql).
  select p.oid, md5(replace(p.prosrc, chr(13), '')) as corpo_md5,
         length(p.prosrc) - length(replace(p.prosrc, chr(13), '')) as n_cr,
         p.prosecdef as definer, p.proconfig as cfg
  from pg_proc p
  where p.proname = 'audit_row_change' and p.pronamespace = to_regnamespace('app')
),
trg as (
  select t.tgname
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
    and t.tgname in ('clients_audit_row', 'projects_audit_row', 'approvers_audit_row', 'approver_invites_audit_row')
),
base as (
  select
    (select count(*) from fn) as fn_existe,
    (select corpo_md5 from fn limit 1) as corpo_md5,
    (select n_cr from fn limit 1) as n_cr,
    (select count(*) from trg) as n_triggers,
    -- dependências da migration 08, criadas pelas migrations 01 a 07
    (to_regnamespace('app') is not null)::int
      + (to_regclass('public.audit_events') is not null)::int
      + (to_regclass('public.approver_invites') is not null)::int
      + (to_regclass('public.approvers') is not null)::int
      + (select count(*)::int from pg_proc p where p.pronamespace = to_regnamespace('app') and p.proname in ('write_audit', 'my_role')) as n_deps,
    -- objetos das migrations 09 em diante (devem estar AUSENTES enquanto a 09 não foi aplicada)
    (select count(*)::int from pg_proc p where p.pronamespace = to_regnamespace('app')
       and p.proname in ('materials_guard_status', 'materials_guard_content', 'grant_revision_ticket', 'has_revision_ticket', 'freeze_version_content'))
      + (to_regclass('app.revision_tickets') is not null)::int as n_pos08
),
rows_ as (
  select 1 as ordem, 'dependências da migration 08 (migrations 01-07)' as item, '6 de 6' as esperado,
         n_deps || ' de 6' as encontrado, (n_deps = 6) as ok from base
  union all
  select 2, 'função app.audit_row_change existe',
         '0 antes da 08, 1 depois', fn_existe::text, null from base
  union all
  select 3, 'corpo da função',
         'migration 08 (f86ee29a…) depois da 08',
         case when fn_existe = 0 then 'ausente'
              when corpo_md5 = 'f86ee29a3a242c30d6500380cf46df2a' and n_cr = 0 then 'igual à migration 08'
              when corpo_md5 = 'f86ee29a3a242c30d6500380cf46df2a' then 'igual à migration 08 (com quebras de linha CRLF)'
              when corpo_md5 = 'f69362fbd696f1dcbf540d1e3d48f1a4' then 'igual à migration 10 (materiais)'
              else 'DIFERENTE de 08 e 10 (md5 sem CR ' || corpo_md5 || ')' end,
         null from base
  union all
  select 4, 'SECURITY DEFINER, search_path vazio e sem EXECUTE para public/anon/authenticated',
         'sim (se a função existe)',
         case when fn_existe = 0 then 'n/a'
              else (select case when f.definer and coalesce(f.cfg @> array['search_path=""'], false)
                                     and not has_function_privilege('anon', f.oid, 'EXECUTE')
                                     and not has_function_privilege('authenticated', f.oid, 'EXECUTE')
                                then 'sim' else 'NÃO' end from fn f limit 1) end,
         null from base
  union all
  select 5, 'triggers *_audit_row (clients, projects, approvers, approver_invites)',
         '0 antes da 08, 4 depois', n_triggers || ' de 4', null from base
  union all
  select 6, 'objetos das migrations 09 em diante (devem estar ausentes)',
         '0', n_pos08::text, (n_pos08 = 0) from base
  union all
  select 7, 'VEREDITO', '',
         case
           when n_deps <> 6 then 'PARE: as migrations 01 a 07 não estão completas neste projeto. Traga este resultado.'
           when n_pos08 > 0 then 'PARE: já existem objetos das migrations 09 em diante. Traga este resultado.'
           when fn_existe = 0 and n_triggers = 0 then 'A) a migration 08 NÃO foi aplicada: pode executá-la inteira, uma vez.'
           when fn_existe = 1 and corpo_md5 = 'f86ee29a3a242c30d6500380cf46df2a' and n_triggers = 4
             then 'B) a migration 08 JÁ ESTÁ APLICADA por completo: NÃO a execute de novo; siga para a 09 só depois de confirmar com o assistente.'
           when fn_existe = 1 and corpo_md5 = 'f86ee29a3a242c30d6500380cf46df2a' and n_triggers < 4
             then 'C) a migration 08 está PARCIAL (função presente, faltam triggers): PARE e traga este resultado; não reexecute.'
           when fn_existe = 1 and corpo_md5 = 'f69362fbd696f1dcbf540d1e3d48f1a4'
             then 'D) a função da migration 10 já existe (fora de ordem): PARE e traga este resultado.'
           else 'E) estado inesperado: PARE e traga este resultado.'
         end,
         null from base
)
select item, esperado, encontrado,
       case when ok is null then '' when ok then 'ok' else 'DIVERGE' end as situacao
from rows_
order by ordem;
