# Banco de produção — aplicação das migrations (roteiro)

Projeto: **Aprova Luvi - Produção** · ID `nvtiynmebffxctqlrwqo` · `https://nvtiynmebffxctqlrwqo.supabase.co` · plano Free · região São Paulo.
**Nunca** o projeto de desenvolvimento "DB Aprova Luvi" (`kswnwootbdzlhdvbhhpk`). Aplicação feita **por você, no SQL Editor, uma migration por vez**. Nada é aplicado automaticamente.

## 1. Tabela oficial (ordem, nome, SHA-256 do texto com LF)

Fonte: `supabase/sql-manifest.sha256` (testado em `src/test/sql-manifest.test.ts`).

| # | Migration | SHA-256 | Bytes |
|---|---|---|---|
| 01 | `20261102120000_core_schema` | `9c7fb3976afe10805140193e4d017826eaee4f9e71dce44d0ffdff9411e15d8c` | 24366 |
| 02 | `20261102120100_functions` | `ab69bc3f1cb681f09b2f02f7a8b25efa74308bdd1c1ea6efec00be91190d78cb` | 12999 |
| 03 | `20261102120200_rls_policies` | `7d2ef2f3e8700862519649da8c8d7b12dcb283c2d2da70fa0955bd2aee520ec6` | 12021 |
| 04 | `20261102120300_storage` | `19be3c1d033d09b4737b07645484247c8b780629b1d17ec772f48d59e5317f2c` | 2284 |
| 05 | `20261103120000_integrity_clients_projects` | `15fd17918de5b7745a994dbef5dd4bf856c9ee3048f66aef7a7fcdfaa34bb3f7` | 2377 |
| 06 | `20261103120100_approvers_multi_client` | `e0e2a6cc12692a913661fff906a4fb67ff2d8e9348b7f0c3ca69878e230eea96` | 4273 |
| 07 | `20261103120200_approver_invites` | `3dd5de9f87bfca4bd1179decbd97ac05c10fbc38a6b3ea9b91ebed17adccc44c` | 4715 |
| 08 | `20261103120300_audit_clients_projects_approvers` | `f8c1c6e6c61d36664e39acb4c83b06f1f0cb5551c661914eba2c5c22721e7c4e` | 3988 |
| 09 | `20261104120000_materials_content_and_guards` | `e420e0eb9e04cd0bcace093cbbe97ede93f424382d5b862dc56aceb535499114` | 7599 |
| 10 | `20261104120100_audit_materials` | `20bcbff95dbc4279bf383d06b254e02a13c7a83463fbecf687a20bdff990cf74` | 4248 |
| 11 | `20261105120000_material_files_rules` | `7797e0d72bccd2540a82f0ce362ef229f6ee9597d1701c57e386ab84a6d8202f` | 5485 |
| 12 | `20261105120100_version_contents_and_revision` | `0654ad15cc3cde3ea8cced82ac79f9e0e14cc43ac2d8d70bd3a35cf95b4609fc` | 7838 |
| 13 | `20261106120000_approval_per_approver` (D1) | `a58f7d39842044efbcb227c28a226a9c4e75d13fffb8a0ebc10c85a950fc4ae0` | 13987 |
| 14 | `20261106120100_approval_link_flow` (D2) | `a099ab3938b46961f9f8bc61094915693574338845bf1b04ab2ac28261bbd51b` | 14400 |
| 15 | `20261107120000_approvers_portal_own_rows` (D3) | `745455e87824aa0e6e63107de8de651a90c14e4d544a84a4b75ee7aa8e80b4cb` | 1104 |
| — | `supabase/preflight.sql` (v2, aceita o RLS automático do Supabase) | `411bce6a6527ad9bda2b0a613f05e6fd42cfa294fad2ca5dcda5c22a95382552` | — |
| — | `supabase/verify-summary.sql` (31 blocos em 1 tabela, gerado do `verify.sql`) | `6f9429eedfdf74a8e95cb6e9cf1c4e5c02da478d63c4e5f7ae9a639bb6e11a8a` | — |

As migrations 05–15 coincidem com os hashes registrados em `MIGRACOES-A2/C/D.md` (aplicadas no dev). As migrations 01–04 não tinham hash nos docs; o manifesto passa a ser o registro.

## 2. Compatibilidade com o projeto novo

- **Extensões, papéis, cron, Vault, Realtime:** nenhuma migration cria ou altera. Só usam `auth.users`, `storage.buckets`/`storage.objects` (padrão do Supabase) e `app`/`public`.
- **Privilégios padrão:** a migration 01 revoga `anon`/`authenticated` por padrão (roda como `postgres`, o papel do SQL Editor). Por isso o preflight acusa se já houver objetos.
- **Storage:** a migration 04 cria o bucket **privado** `materials` (50 MB por arquivo = teto do plano Free; `on conflict` idempotente).
- **Postgres 17:** testado em PGlite 17; confira em *Settings → Infrastructure* que o projeto é 17.
- **Plano Free — o que ele NÃO dá (decisão sua antes de dados reais):** pausa por inatividade (~7 dias sem uso), sem backups diários/PITR gerenciados e sem proteção contra senhas vazadas (isso é Pro). Para produção com clientes, recomendo **Pro** antes do lançamento. O SMTP próprio (Resend) funciona no Free.
- **RLS automático do Supabase (`public.rls_auto_enable()` + event trigger `ensure_rls`):** projetos novos podem vir com ele (opção "Automatically enable RLS" do painel). Conforme a [documentação de Event Triggers do Supabase](https://supabase.com/docs/guides/database/postgres/event-triggers), a função é `RETURNS EVENT_TRIGGER`, `plpgsql`, `SECURITY DEFINER`, `SET search_path = pg_catalog`, e o gatilho é `ensure_rls ON ddl_command_end WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')`. O pré-voo e o `verify.sql` aceitam **exclusivamente** esse objeto e **só se a estrutura inteira bater** (dono `postgres`, linguagem, SECURITY DEFINER, `search_path=pg_catalog`, corpo que só habilita RLS com um único `EXECUTE`, sem instruções de concessão/escrita, e o event trigger exato). Qualquer variação, ou qualquer outra função/tabela, continua sendo acusada; o bloco `CHECK: função public.rls_auto_enable…` mostra o que difere. Como a função devolve `event_trigger`, ninguém consegue chamá-la diretamente (a API a expõe, mas a chamada falha). **Nada é alterado no Supabase.** O corpo oficial não está publicado palavra por palavra: a validação é estrutural, e o bloco `INFO` do pré-voo mostra a definição real para conferência.
  Efeito colateral: novas tabelas em `public` já nascem com RLS ligada (a migration 03 também liga; sem conflito).
- **Isolamento do dev:** nenhuma etapa abre conexão com o dev; o app só aponta para a produção quando as variáveis forem trocadas na Vercel (Etapa 3).

## 3. Procedimento (você executa; eu oriento)

Ferramenta: `npm run sql:copy -- <n>` copia o SQL para a área de transferência **depois de conferir o SHA-256** contra o manifesto e de ler o texto de volta da área de transferência. Se falhar, **não cole**.

1. **Confirmar o projeto:** no painel, o ID na URL deve ser `nvtiynmebffxctqlrwqo` e o nome "Aprova Luvi - Produção". Abra **SQL Editor → New query**.
2. **Pré-voo:** `npm run sql:copy -- preflight` → colar → Run. Todas as 7 linhas devem ter `violacoes = 0`. Se alguma for > 0, pare.
3. **Migrations 01 a 15, uma por vez:** `npm run sql:copy -- 1`, colar numa query nova, Run, conferir "Success. No rows returned", repetir com 2, 3… Na **01**, o aviso "creates tables without enabling RLS" é esperado: **Run without RLS** (a RLS vem na 03). **Parar e me informar após as migrations 04, 08, 12 e 15**, ou em qualquer erro/aviso diferente.
4. **Verificação:** `npm run sql:copy -- verify` → colar → Run. Esperado: **31 linhas, todas com `violacoes = 0`**.
5. **Conferência visual:** *Storage* → bucket `materials` existe e **não** é público; *Authentication → Users* continua vazio.
6. Me informe o resultado (contagens, sem dados). Eu registro a aplicação em `docs/` com data e hashes.

**Se uma migration falhar:** o SQL Editor executa o texto como uma única consulta, então o erro desfaz aquela migration. Não reaplique nem edite o SQL: me traga o erro. O banco é novo e vazio, então o pior caso é recriar o projeto.
