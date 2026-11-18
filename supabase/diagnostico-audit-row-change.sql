-- Aprova Luvi — EVIDÊNCIA sobre app.audit_row_change() (somente leitura, não altera nada).
--
-- Quando o diagnóstico da migration 08 acusou "corpo DIFERENTE", esta consulta mostra por quê: compara o
-- corpo da função do banco com o da migration 08 por três critérios (bruto, sem o caractere CR das quebras
-- de linha CRLF, e sem espaços no fim das linhas), confere privilégios e os 4 triggers de auditoria.
-- Cole TUDO no SQL Editor e clique em Run: uma tabela (item, encontrado, esperado, situacao); a última linha,
-- VEREDITO, resume. Nenhum valor secreto aparece aqui.
--
-- md5 esperado do corpo (texto da migration 08, quebras de linha LF): f86ee29a3a242c30d6500380cf46df2a

with fn as (
  select p.oid, p.prosrc, pg_get_userbyid(p.proowner) as dono, p.prosecdef as definer, p.proconfig::text as cfg, p.proacl::text as acl
  from pg_proc p
  where p.proname = 'audit_row_change' and p.pronamespace = to_regnamespace('app')
),
m as (
  select
    oid, dono, definer, cfg, acl,
    octet_length(prosrc) as bytes,
    length(prosrc) - length(replace(prosrc, chr(13), '')) as n_cr,
    md5(prosrc) as md5_bruto,
    md5(replace(prosrc, chr(13), '')) as md5_sem_cr,
    md5(regexp_replace(replace(prosrc, chr(13), ''), '[ \t]+(\n|$)', '\1', 'g')) as md5_sem_cr_e_espacos
  from fn
),
trg as (
  select t.tgname, pg_get_triggerdef(t.oid) as def, t.tgenabled::text as habilitado
  from pg_trigger t
  where t.tgname in ('clients_audit_row', 'projects_audit_row', 'approvers_audit_row', 'approver_invites_audit_row')
    and not t.tgisinternal
),
esperado(nome, def) as (
  values
    ('clients_audit_row', 'CREATE TRIGGER clients_audit_row AFTER INSERT OR UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION app.audit_row_change()'),
    ('projects_audit_row', 'CREATE TRIGGER projects_audit_row AFTER INSERT OR UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION app.audit_row_change()'),
    ('approvers_audit_row', 'CREATE TRIGGER approvers_audit_row AFTER INSERT OR UPDATE ON public.approvers FOR EACH ROW EXECUTE FUNCTION app.audit_row_change()'),
    ('approver_invites_audit_row', 'CREATE TRIGGER approver_invites_audit_row AFTER INSERT OR UPDATE ON public.approver_invites FOR EACH ROW EXECUTE FUNCTION app.audit_row_change()')
),
rows_ as (
  select 1 as ordem, 'tamanho do corpo (bytes) e caracteres CR (\r)' as item,
         bytes || ' bytes, ' || n_cr || ' CR' as encontrado, '2510 bytes, 0 CR (arquivo LF)' as esperado, null::boolean as ok from m
  union all
  select 2, 'md5 do corpo, bruto', md5_bruto, 'f86ee29a3a242c30d6500380cf46df2a', (md5_bruto = 'f86ee29a3a242c30d6500380cf46df2a') from m
  union all
  select 3, 'md5 do corpo sem os CR (normaliza CRLF para LF)', md5_sem_cr, 'f86ee29a3a242c30d6500380cf46df2a', (md5_sem_cr = 'f86ee29a3a242c30d6500380cf46df2a') from m
  union all
  select 4, 'md5 do corpo sem CR e sem espaços no fim das linhas', md5_sem_cr_e_espacos, 'f86ee29a3a242c30d6500380cf46df2a', (md5_sem_cr_e_espacos = 'f86ee29a3a242c30d6500380cf46df2a') from m
  union all
  select 5, 'dono, SECURITY DEFINER, search_path',
         dono || ', definer=' || definer || ', ' || coalesce(cfg, 'sem search_path'),
         'postgres, definer=true, {search_path=""}',
         (definer and cfg = '{"search_path=\"\""}') from m
  union all
  select 6, 'EXECUTE (anon / authenticated / service_role / lista de ACL)',
         has_function_privilege('anon', oid, 'EXECUTE')::text || ' / ' || has_function_privilege('authenticated', oid, 'EXECUTE')::text
           || ' / ' || has_function_privilege('service_role', oid, 'EXECUTE')::text || ' / ' || coalesce(acl, 'padrão (PUBLIC)'),
         'false / false / (qualquer) / só o dono',
         (not has_function_privilege('anon', oid, 'EXECUTE') and not has_function_privilege('authenticated', oid, 'EXECUTE')) from m
  union all
  select 10 + row_number() over (order by e.nome), 'trigger ' || e.nome,
         coalesce(t.def, 'AUSENTE') || case when t.tgname is not null and t.habilitado <> 'O' then ' [desabilitado]' else '' end,
         e.def, coalesce(t.def = e.def and t.habilitado = 'O', false)
  from esperado e left join trg t on t.tgname = e.nome
),
veredito as (
  select
    case
      when not exists (select 1 from m) then 'FUNÇÃO AUSENTE: a migration 08 não foi aplicada (não é o caso do veredito E).'
      when (select md5_bruto = 'f86ee29a3a242c30d6500380cf46df2a' from m) then 'IGUAL à migration 08 (byte a byte).'
      when (select md5_sem_cr = 'f86ee29a3a242c30d6500380cf46df2a' from m)
        then 'IGUAL à migration 08 exceto as quebras de linha (CRLF em vez de LF): mesma lógica; o diagnóstico anterior deu falso positivo.'
      when (select md5_sem_cr_e_espacos = 'f86ee29a3a242c30d6500380cf46df2a' from m)
        then 'IGUAL à migration 08 exceto CRLF e/ou espaços no fim das linhas: mesma lógica; falso positivo do diagnóstico anterior.'
      else 'DIFERENTE da migration 08 mesmo ignorando CRLF e espaços: PARE e rode diagnostico-audit-row-change-corpo.sql.'
    end as texto
)
select item, encontrado, esperado,
       case when ok is null then '' when ok then 'ok' else 'DIVERGE' end as situacao
from (
  select ordem, item, encontrado, esperado, ok from rows_
  union all
  select 99, 'VEREDITO', (select texto from veredito), '', null
) r
order by ordem;
