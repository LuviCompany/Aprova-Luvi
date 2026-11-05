`# Migrations D1 e D2 (motor de aprovação, Módulo 4)
`
`Estado em **2026-11-04**: testadas localmente (PGlite, 301 testes de banco) e **APLICADAS no projeto de desenvolvimento "DB Aprova Luvi" (`kswnwootbdzlhdvbhhpk`) em 2026-11-04**, uma por vez, na ordem D1, D2, com `verify.sql` de 30 blocos todos em 0 (seção 6). Para qualquer outro projeto vale o procedimento da seção 4, com autorização expressa.
`
`## 1. Arquivos e hashes
`
`| # | Arquivo | SHA-256 (texto com LF) | Bytes |
`|---|---|---|---|
`| D1 | `20261106120000_approval_per_approver.sql` | `a58f7d39842044efbcb227c28a226a9c4e75d13fffb8a0ebc10c85a950fc4ae0` | 13987 |
`| D2 | `20261106120100_approval_link_flow.sql` | `a099ab3938b46961f9f8bc61094915693574338845bf1b04ab2ac28261bbd51b` | 14400 |
`| — | `supabase/verify.sql` (30 blocos) | `e0a2e3c1beff9a3c6914de42d128a6cdf01da1643b08ae0917902e17213e67be` | 14454 |
`
`Recalcule antes de aplicar (o hash vale para o texto com quebras de linha LF). Se o Windows converteu para CRLF, normalize antes de comparar.
`
`## 2. D1 — vários aprovadores
`
`1. `approval_requests` ganha `approver_id` e `submission_id` (a "rodada" de um envio). FK composta `(approver_id, client_id)` para `approvers`. Linhas novas exigem os dois (`CHECK ... NOT VALID`, para não reescrever dado antigo; a tabela está vazia nos projetos atuais).
`2. O índice único "uma solicitação aberta por versão" é trocado por **uma aberta por (versão, aprovador)**.
`3. **`INSERT` direto de `authenticated` em `approval_requests` é revogado.** O envio é só por `public.submit_for_approval(version, aprovadores[], prazo, recado)`: `SECURITY DEFINER`, só equipe com acesso ao cliente, 1 a 20 aprovadores distintos, ativos e do cliente, prazo futuro, material em rascunho; cria todas as solicitações da rodada numa transação (tudo ou nada) e audita `material.submitted` (ids e contagem, sem texto livre).
`4. `app.requests_before_insert` reescrita (aceita várias solicitações da mesma rodada; confere aprovador, versão mais recente e arquivos).
`5. **`app.record_decision` reescrita** (único caminho que grava decisão): trava a linha do **material** e depois a da solicitação (ordem global; decisões concorrentes se serializam), exige que a solicitação seja DO aprovador, que o material esteja `aguardando` e que a versão seja a mais recente. **Política:** alteração → material em `alteracao`, demais solicitações abertas da rodada canceladas e seus links revogados; aprovação → o material só vira `aprovado` quando não resta solicitação aberta na rodada. As decisões já gravadas nunca mudam (tabela imutável).
`6. `cancel_approval_request` cancela a **rodada inteira**, revoga os links e devolve o material a `rascunho` (somente se estava `aguardando`).
`7. `app.version_content` (fonte única do conteúdo apresentado) e `freeze_version_content` reescrita para usá-la. Reenviar a **mesma versão** depois de um cancelamento só é aceito se o conteúdo atual for igual ao congelado; senão: "crie uma nova versão" (o conteúdo congelado nunca muda).
`8. Política `requests_select_portal` restrita: cada aprovador lê **só as próprias** solicitações.
`
`## 3. D2 — link rápido com código e sessão
`
`Tudo é executado pelo **servidor** (service_role); nenhuma função abaixo é executável por `anon` nem `authenticated`.
`
`| Função | O que faz |
`|---|---|
`| `link_resolve(token_hash)` | estado do link (`ok`, `invalid`, `revoked`, `expired`, `used`, `closed`) e, se ok, empresa + e-mail mascarado |
`| `link_issue_code(token_hash, code_hash)` | grava o HMAC do código (10 min); 1 código/60 s e 5/hora por link; o anterior deixa de valer |
`| `link_verify_code(token_hash, code_hash, session_hash)` | confere o código (máx. **5 tentativas** por código; resposta por status, sem exceção, para o contador persistir) e abre a sessão de 30 min |
`| `link_session_context(token_hash, session_hash)` | token + sessão válidos → ids do escopo do link |
`| `decide_with_link_session(...)` | **único** caminho de decisão por link; revalida link, solicitação, versão e sessão sob bloqueio |
`
`Também: `create_approval_link` exige que o aprovador seja o **da solicitação**, revoga o link anterior (um ativo por solicitação) e audita; `revoke_approval_link` audita; **`decide_via_link` foi removida** (decidia sem exigir verificação). `app.link_state` é interna. Auditoria nova: `approval_link.created`, `approval_link.revoked`, `approval_link.verified`, `approval_request.cancelled`, `decision.recorded` — só ids, canal e carimbos; **nunca** token, código, e-mail ou texto livre.
`
`## 4. Procedimento de aplicação (quando autorizado)
`
`1. Confirmar projeto, `git status` limpo e hashes acima. 2. Aplicar **D1**, parar e conferir; aplicar **D2**. 3. Rodar `supabase/verify.sql` (30 blocos): **todos em 0**. 4. Conferências: `has_table_privilege('authenticated','public.approval_requests','INSERT')` falso; `decide_via_link` inexistente; as cinco funções `link_*`/`decide_with_link_session` só com `EXECUTE` para `service_role`; `submit_for_approval` só para `authenticated`. 5. No app: definir `APPROVAL_LINK_SECRET`, `SUPABASE_SECRET_KEY` e o provedor de e-mail no ambiente. 6. Rodar a validação operacional com dados fictícios (`MODULO-4.md`, seção 7).
`
`## 5. Reversão de emergência
`
`Nova migration, nunca edição. Só antes de existirem solicitações/decisões que dependam do modelo novo (solicitações com `approver_id`): recriar `decide_via_link` com a verificação de sessão (nunca a versão sem código), devolver o `INSERT` e o índice antigos. Decisões são imutáveis: não há como "desfazer" dado gravado, só desligar o fluxo.
`
`## 6. Registro da aplicação no projeto de desenvolvimento (2026-11-04)
`
`Executada pelo SQL Editor do painel do Supabase, com a autorização expressa do usuário para o projeto "DB Aprova Luvi", e **só neste projeto**.
`
`1. **Pré-conferência (somente leitura):** nenhuma das colunas/funções novas existia, `decide_via_link` existia, `approval_requests` e `decisions` com **0 linhas** (nada a migrar).
`2. **D1:** texto colado conferido no navegador por SHA-256 antes de executar (`a58f7d39…c4ae0`, 13987 bytes). O painel avisou "operações destrutivas" (o `drop index` e o `drop policy` esperados); confirmado. Resultado: *Success. No rows returned.* Conferência: 2 colunas novas, índice novo presente e antigo ausente, `INSERT` de `authenticated` em `approval_requests` falso (tabela e colunas), `submit_for_approval` executável por `authenticated` e não por `anon`, `app.version_content` sem `EXECUTE`.
`3. **D2:** mesmo procedimento (`a099ab39…bd51b`, 14400 bytes); aviso pelo `drop function decide_via_link`, esperado; *Success. No rows returned.* Conferência: as cinco funções do fluxo por link com `EXECUTE` para `service_role` e não para `authenticated`/`anon`; `decide_via_link` inexistente.
`4. **`verify.sql`** (30 blocos, cada um dentro de `select count(*) from (…)`, texto de 15028 bytes conferido por SHA-256 `d1ed8647…ada7`): **30 blocos, 0 com violação, total 0**.
`5. Nenhum dado foi criado nem alterado (as migrations não inserem linhas) e nenhum e-mail foi enviado. O app ainda precisa de `APPROVAL_LINK_SECRET`, `SUPABASE_SECRET_KEY` e provedor de e-mail no ambiente para o fluxo por link, e a validação operacional com dados fictícios (`MODULO-4.md`, seção 7) continua pendente.
`
`## 7. D3 — privacidade dos aprovadores no portal (APLICADA no dev em 2026-11-04)
`
`Arquivo `20261107120000_approvers_portal_own_rows.sql` · SHA-256 `745455e87824aa0e6e63107de8de651a90c14e4d544a84a4b75ee7aa8e80b4cb` (1104 bytes, LF) · `verify.sql` passa a ter **31 blocos** (SHA-256 `c914030df99bf8ba1bb81c4c32d4e05f5acea698530d2b8a60ebaf8da7781729`, 14855 bytes).
`
`**Achado (revisão de privacidade):** a política \`approvers_select_portal\` deixava qualquer aprovador de um cliente ler **todas** as linhas de \`approvers\` desse cliente: nome, e-mail, cargo e o id do login (\`profile_id\`) dos colegas. Confirmado no banco real, com \`role authenticated\` e o \`uid\` do aprovador de teste (3 aprovadores visíveis). O portal não precisa disso: só lê o vínculo do próprio aprovador (\`profile_id = auth.uid()\`), e o app mostra os colegas apenas como "Outro aprovador".
`
`**Correção mínima:** recriar a política com \`profile_id = auth.uid() and client_id in (select app.my_client_ids())\`. O aprovador lê só a(s) própria(s) linha(s) (uma por empresa em que aprova), sempre restrita a vínculo/cliente/perfil ativos. A equipe não muda. As funções \`SECURITY DEFINER\` (\`app.my_client_ids\`, \`app.my_approver_id\`) não dependem da política, então comentário, decisão e solicitações seguem iguais. Nenhum dado é alterado.
`
`**Fora do escopo (decidido):** \`decisions\` (id do aprovador, sem nome nem e-mail) e \`comments.author_name\` (conteúdo colaborativo: o nome de quem comentou aparece no comentário) continuam como estão; \`approval_requests\` já era restrita ao próprio aprovador (D1). Não foi adicionado IP às decisões do portal.
`
`**Testes locais:** \`src/test/db/approvers-privacy.test.ts\` (7): não lê nome/e-mail/cargo/profile_id de colegas (só-link, inativo, outro com login), aprovador de duas empresas vê as duas linhas dele e nada mais, vínculo como o portal usa, desativado/arquivado some, equipe e outra agência/anônimo, e decidir/comentar seguem funcionando. Os testes **falham sem a D3** (4 de 7) e passam com ela; suíte de banco 321/321.
`
`**Aplicação (quando autorizada):** como as anteriores: conferir projeto e hash, aplicar, depois \`verify.sql\` (31 blocos, todos em 0). Reversão: recriar a política original (\`client_id in (select app.my_client_ids())\`), o que **reabre** a exposição.

### 7.1 Registro da aplicação da D3 no projeto de desenvolvimento (2026-11-04)

Executada no SQL Editor do projeto "DB Aprova Luvi" (`kswnwootbdzlhdvbhhpk`), com autorização expressa do usuário, **só neste projeto**.

1. **Pré-conferência (somente leitura):** política `approvers_select_portal` com o texto antigo (`client_id IN (SELECT app.my_client_ids())`), 5 aprovadores, 4 políticas em `approvers`.
2. **D3:** SQL colado conferido por SHA-256 no navegador antes de executar (`745455e8…80b4cb`, 1104 bytes). O painel avisou "operações destrutivas" (o `drop policy` esperado); confirmado. *Success. No rows returned.*
3. **Leitura como o aprovador de teste** (somente leitura, `role authenticated` + `uid` dele): vê **só a própria linha** de `approvers` (colegas visíveis: **0**, antes eram 3); o resto segue igual (cliente TESTE D, 1 material, 3 versões, 4 decisões do cliente, 2 solicitações próprias, 3 objetos de storage do próprio cliente, `app.my_client_ids()` = 1, `app.my_approver_id(cliente)` = o aprovador dele); material da outra empresa: 0.
4. **`verify.sql`** (31 blocos, texto de 15493 bytes conferido por SHA-256 `296fe8c1…76e58`): **31 blocos, 0 com violação, total 0**.
5. Nenhum dado foi criado nem alterado (a migration só troca a política) e nenhum e-mail foi enviado.
