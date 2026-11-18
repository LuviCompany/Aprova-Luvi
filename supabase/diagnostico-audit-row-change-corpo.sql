-- Aprova Luvi — DEFINIÇÃO de app.audit_row_change() no banco (somente leitura, não altera nada).
--
-- Rode SÓ se o VEREDITO de diagnostico-audit-row-change.sql for "DIFERENTE ... PARE". Devolve o texto completo
-- da função (código do repositório, sem segredos) para comparar com a migration 08. Cada quebra de linha CR
-- aparece como "␍" no final da linha, para tornar visível um CRLF.

select pg_get_functiondef(p.oid) as definicao,
       replace(replace(p.prosrc, chr(13), '␍'), chr(10), E'⏎\n') as corpo_visivel,
       length(p.prosrc) as caracteres,
       md5(p.prosrc) as md5_bruto
from pg_proc p
where p.proname = 'audit_row_change' and p.pronamespace = to_regnamespace('app');
