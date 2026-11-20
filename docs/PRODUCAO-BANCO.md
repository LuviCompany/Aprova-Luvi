# Banco de produção — aplicação das migrations (roteiro)

Projeto: **Aprova Luvi - Produção** · ID `nvtjynmebffxctqlrwqo` · `https://nvtjynmebffxctqlrwqo.supabase.co` · plano Free · região São Paulo.
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
| 16 | `20261120120000_service_role_grants` (aplicada em produção em 2026-11-20) | `2baf78aa0ad3fab1a6d379b63b1bfa9e137bc2a193b67e023b77944d98d27704` | 3424 |
| 17 | `20261121120000_team_members` (**pendente em produção**) | `29a68af00fa6c55f9162e5822758cfd0bec4144a68033df22545346ecefccd97` | 7446 |
| — | `supabase/preflight.sql` (v2, aceita o RLS automático do Supabase) | `411bce6a6527ad9bda2b0a613f05e6fd42cfa294fad2ca5dcda5c22a95382552` | — |
| — | `supabase/verify-summary.sql` (31 blocos em 1 tabela, gerado do `verify.sql`) | `e89b090f355806b5a07a125b25c5ef127a8b8ac9348fbccc7f369017c7e11d7f` | — |
| — | `supabase/verify-service-role.sql` (privilégios do service_role, antes/depois da migration 16) | `34cd7216ac08d07c5ff17d05fce0e41972c53bfcc503814cc10dd896a124a779` | — |
| — | `supabase/verify-team-members.sql` (funções e privilégios da migration 17, antes/depois) | `5f22062d73cff857791faf8922ae3e276657e196e6e5080ed5b6dfc1977f3c63` | — |

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

1. **Confirmar o projeto:** no painel, o ID na URL deve ser `nvtjynmebffxctqlrwqo` e o nome "Aprova Luvi - Produção". Abra **SQL Editor → New query**.
2. **Pré-voo:** `npm run sql:copy -- preflight` → colar → Run. Todas as 7 linhas devem ter `violacoes = 0`. Se alguma for > 0, pare.
3. **Migrations 01 a 15, uma por vez:** `npm run sql:copy -- 1`, colar numa query nova, Run, conferir "Success. No rows returned", repetir com 2, 3… Na **01**, o aviso "creates tables without enabling RLS" é esperado: **Run without RLS** (a RLS vem na 03). **Parar e me informar após as migrations 04, 08, 12 e 15**, ou em qualquer erro/aviso diferente.
4. **Verificação:** `npm run sql:copy -- verify` → colar → Run. Esperado: **31 linhas, todas com `violacoes = 0`**.
5. **Conferência visual:** *Storage* → bucket `materials` existe e **não** é público; *Authentication → Users* continua vazio.
6. Me informe o resultado (contagens, sem dados). Eu registro a aplicação em `docs/` com data e hashes.

**Se uma migration falhar:** o SQL Editor executa o texto como uma única consulta, então o erro desfaz aquela migration. Não reaplique nem edite o SQL: me traga o erro. O banco é novo e vazio, então o pior caso é recriar o projeto.

## 4. Incidente: migration 08 falhou com 42723 (`audit_row_change already exists`)

**Causa exata.** `app.audit_row_change()` é criada **uma única vez**, pela migration 08, com `CREATE FUNCTION` (sem `OR REPLACE`); a migration 10 só a substitui (`CREATE OR REPLACE`) e nenhuma das migrations 01–07 a menciona. O erro 42723 acontece no **primeiro comando** da 08, então a função **já existia** quando a 08 rodou. Pelo código, isso só é possível se a 08 (ou a 10) já tinha sido executada neste projeto antes: o caso mais provável é uma execução anterior da 08 que **terminou no servidor** (clique duplo em Run, aba reaproveitada, resposta perdida por instabilidade de rede) e foi repetida. O que não dá para saber pelo código é qual das duas execuções você viu: só a consulta de diagnóstico mostra o estado real.

**Estado esperado após a falha.** A execução que falhou **não alterou nada**: o comando que falha é o primeiro da migration, então nenhum trigger nem permissão dela chegou a rodar (testado em `migration-08-sequence.test.ts`: reexecutar a 08 reproduz o 42723 e o catálogo fica idêntico). O estado do banco é, portanto, o da **execução anterior**: (B) 08 completa (função com o corpo da 08 + 4 triggers `*_audit_row`), ou (A) sem a 08 (impossível pelo erro).

**Verificação (somente leitura; rode ANTES de qualquer outra coisa):**

```bash
npm run sql:copy -- diagnostico-migration-08
```

Cole no SQL Editor de "Aprova Luvi - Produção" e clique em Run. A última linha, `VEREDITO`, diz o que fazer:

| Veredito | Significado | O que fazer |
|---|---|---|
| **B** | 08 já aplicada por completo (função com o corpo da 08 e os 4 triggers) | **Não reexecutar a 08.** Siga para a 09 só depois de confirmar com o assistente |
| A | 08 não aplicada | Executar a 08 inteira, uma vez |
| C | função presente, faltam triggers | Parar; trazer o resultado (a correção seria só criar os triggers que faltam) |
| D / E / PARE | função da migration 10, estado inesperado ou objetos da 09 em diante | Parar; trazer o resultado |

**Correção.** Nenhuma migration precisa mudar: o erro não é da migration, é de repetir uma migration já aplicada. Tornar a 08 idempotente seria desnecessário e a afastaria do arquivo já aplicado no dev (migrations são imutáveis). Hashes e manifesto das 15 migrations seguem iguais; só o manifesto ganhou o `diagnostico-migration-08.sql`.

**Retomada segura.** (1) Diagnóstico; (2) veredito B → **não** rodar a 08 de novo, anotar a 08 como aplicada; (3) se o veredito for A, rodar a 08 uma vez e repetir o diagnóstico (esperado: B); (4) só então seguir para a 09. Em qualquer outro veredito, parar. Para evitar repetição: depois de cada Run, **não clique de novo**; confirme o resultado e, na dúvida, rode o diagnóstico em vez de repetir a migration.

### 4.1 Resultado do diagnóstico em produção: veredito E (falso positivo do diagnóstico)

O diagnóstico acusou "corpo DIFERENTE de 08 e 10", mas com as dependências 6/6, permissões corretas e **4 de 4 triggers**. Esse conjunto é o de uma **migration 08 aplicada por completo** cujo texto chegou ao banco com **quebras de linha CRLF**.

**Causa demonstrada (em teste, `audit-row-change-evidence.test.ts`).** O Postgres guarda o corpo de uma função **byte a byte** (`pg_proc.prosrc`); não há normalização, e `pg_get_functiondef()` só monta o cabeçalho (não altera o corpo). O editor do navegador (Windows) grava as quebras como CRLF: aplicando a migration 08 com `\n` trocado por `\r\n`, o corpo ganha 57 caracteres CR, o md5 bruto muda (`fb58f9dd…` em vez de `f86ee29a…`) e **sem os CR volta a ser exatamente `f86ee29a3a242c30d6500380cf46df2a`**. A lógica é idêntica (o PL/pgSQL trata CR como espaço). O erro estava no diagnóstico, que comparava o md5 bruto; ele agora compara **sem CR** e descreve o que viu ("igual à migration 08 (com quebras de linha CRLF)"). O `sql:copy` conferia o texto na área de transferência (LF); a conversão acontece depois, no navegador.

**Falta confirmar em produção (somente leitura):**

```bash
npm run sql:copy -- diagnostico-audit-row-change
```

Cole no SQL Editor e clique em Run. Esperado: `tamanho do corpo` com CR > 0, `md5 do corpo, bruto` DIVERGE, `md5 do corpo sem os CR` ok, dono/SECURITY DEFINER/search_path ok, EXECUTE ok, 4 triggers ok e VEREDITO "IGUAL à migration 08 exceto as quebras de linha (CRLF em vez de LF)… falso positivo". Se o veredito for "DIFERENTE… PARE", rode `npm run sql:copy -- diagnostico-audit-row-change-corpo` e traga o resultado (é código do repositório, sem segredos). Só então, com o diagnóstico da 08 (`npm run sql:copy -- diagnostico-migration-08`) em **B**, a 08 conta como aplicada; a 09 continua **não** autorizada até lá.

**Correção.** Só no diagnóstico (já feita). Nenhuma migration muda, nada é alterado no banco, e os hashes das migrations seguem iguais. Efeito prático: tudo o que o editor do navegador gravou em produção terá CRLF dentro dos corpos de função; é inofensivo, mas **qualquer comparação de hash de corpo no banco deve ignorar o CR**.

## 5. Migration 16: privilégios do service_role (achado em 2026-11-20; NÃO aplicada)

**Problema.** Desde 30/05/2026 os projetos novos do Supabase não dão privilégios automáticos nas tabelas do schema `public`. O de produção nasceu assim: `service_role` sem SELECT em `profiles` (42501, HTTP 403) e nas outras 16 tabelas (`tabelas_sem_leitura_para_service_role = 17`). As migrations 1 a 15 concedem as tabelas ao `authenticated`, mas nunca ao `service_role`: o desenvolvimento (criado antes, com ALL por padrão) escondeu a falta. Sem a correção falham o bootstrap, os convites, a aprovação por link, a limpeza e o backup dos arquivos.

**O que a migration 16 faz.** Revoga tudo do `service_role` em `public` e concede o mínimo que o código usa: SELECT em 11 tabelas (`organizations`, `profiles`, `clients`, `approvers`, `approver_invites`, `materials`, `material_versions`, `material_version_contents`, `material_files`, `comments`, `decisions`); INSERT por coluna em `organizations` e `profiles`; DELETE em `profiles` (desfaz convite com falha); UPDATE por coluna em `approvers.profile_id` e em quatro colunas de `approver_invites`. Nada em `projects`, `approval_*`, `audit_events`, schema `app` nem sequências (os ids são uuid); sem TRUNCATE/REFERENCES/TRIGGER. Não mexe em RLS, políticas, `anon`, `authenticated` nem funções. Prova: `src/test/db/service-role-grants.test.ts` (reproduz o erro de produção sem a migration, executa cada operação do código depois dela, nega todo o resto e compara os resumos antes/depois).

**Procedimento (só com a sua autorização; uma etapa por vez, no SQL Editor do projeto `nvtj…`).**
1. `npm run sql:copy -- verify-service-role` e execute. **Esperado ANTES (medido na produção em 2026-11-20):** blocos 1 e 2 = 12; **bloco 3 = 51** (o `service_role` tem TRUNCATE, REFERENCES e TRIGGER nas 17 tabelas, confirmado: 17/17/17); blocos 4 a 9 = 0. Impressões de referência da produção (blocos 10 a 14): `413bc2522be18bb692b396da54339bfd`, `c79de199e3a4a1efc01087c6b5a6d780`, `a303e87d7693d8888b50bc81791c0a20`, `3e3fbf90ae1a32bbd7c733ca765f48be` e `bbc516133b4f23ccab62b44e6b9618ad / 13`.
2. `npm run sql:copy -- 16` (confere o SHA-256 acima) e execute a migration. Não repita se der erro: traga a mensagem.
3. Rode `verify-service-role` de novo. **Esperado DEPOIS:** blocos 1 a 9 = 0 (a migration também revoga os 51) e as impressões 10 a 14 **idênticas** às de antes.
4. Rode `supabase/verify-summary.sql` (31/31 em 0) e `node scripts/bootstrap-admin.mjs … --check-connection` (agora deve dizer "Conexão OK. Perfis existentes: 0").
No desenvolvimento a migration também reduz o ALL padrão ao mínimo (bloco 3 mostra o excesso antes); só aplique lá se decidir alinhar os ambientes.

## 6. Migration 17: membros da equipe convidados pelo painel (NÃO aplicada)

**O que faz.** Permite que um **administrador ativo** convide Administrador, Designer ou Atendimento pela tela Usuários, com as regras no banco e auditoria de quem convidou. Cria três funções e nenhuma tabela; não altera RLS, políticas nem privilégios de tabela:
- `public.add_team_member(p_user_id, p_full_name, p_email, p_role)`: só administrador ativo (42501 para os demais); organização **sempre** a do administrador; papel só `admin`, `designer` ou `atendimento` (22023); o id e o e-mail precisam ser do **mesmo** usuário do Auth, ainda sem e-mail confirmado e sem login (22023); duplicado vira 23505; grava `team_member.invited` na auditoria com o administrador como autor e só `role` e `actor_role` no metadata (sem nome, e-mail, token, senha ou link).
- `public.reserve_team_invite_resend(p_user_id)`: reserva o reenvio (administrador ativo, membro da equipe da mesma organização, nunca aprovador), no máximo 1 por minuto por pessoa (conta a auditoria imutável), e grava `team_member.invite_resent`.
- `app.write_org_audit(...)`: escrita interna de auditoria no nível da organização; sem EXECUTE para ninguém da API.
`EXECUTE` das duas funções públicas: só `authenticated`; `anon`, `public` e `service_role` não. O papel de um membro **não muda** nesta etapa (nenhuma função nem privilégio altera `profiles.role`).

**Ordem de implantação (seguro e reversível até o primeiro convite).**
1. Rode `supabase/verify-team-members.sql` ANTES (`npm run sql:copy -- verify-team-members`). Esperado: bloco 1 = 3, blocos 2 a 8 = 0. Guarde as impressões 9 a 12.
2. Aplique a migration (`npm run sql:copy -- 17`, que confere o SHA-256 acima). Se der erro, não repita: traga a mensagem.
3. Rode a verificação DEPOIS: blocos 1 a 8 = 0 e as impressões 9 a 12 **idênticas**. Rode `verify-summary.sql` (31/31 em 0; o `verify.sql` agora lista as duas funções novas como permitidas ao `authenticated`).
4. Só então publique o código da tela (ensaio, depois promoção). O código novo **falha fechado** se a migration ainda não existir (o convite mostra erro e nada é criado, porque o usuário do Auth criado é apagado).
5. Convites reais só com a sua decisão, um por vez: o e-mail vai para a pessoa e o link vale 24 horas, de uso único.

**Reversão.** Antes de qualquer convite: `drop function public.add_team_member(uuid, text, text, public.app_role); drop function public.reserve_team_invite_resend(uuid); drop function app.write_org_audit(uuid, uuid, text, text, uuid, jsonb);` (só no SQL Editor, com a sua decisão). Depois de convites, os perfis e a auditoria ficam; não apague.

**Limites conhecidos.** Não há desativar/remover usuário nem trocar papel pelo painel (próxima etapa). Quem recebe o link dentro de 24 horas vira o papel do convite: confira o e-mail (a janela exige digitá-lo duas vezes). Ative a verificação em duas etapas dos administradores no Supabase/Vercel/GitHub quando possível.
