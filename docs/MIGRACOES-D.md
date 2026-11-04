# Migrations D1 e D2 (motor de aprovação, Módulo 4)

Estado em **2026-11-04**: as duas migrations estão **escritas e testadas LOCALMENTE** (PGlite, 301 testes de banco) e **NÃO foram aplicadas em nenhum projeto Supabase**. Aplicar exige autorização expressa, uma de cada vez, na ordem D1, D2.

## 1. Arquivos e hashes

| # | Arquivo | SHA-256 (texto com LF) | Bytes |
|---|---|---|---|
| D1 | `20261106120000_approval_per_approver.sql` | `a58f7d39842044efbcb227c28a226a9c4e75d13fffb8a0ebc10c85a950fc4ae0` | 13987 |
| D2 | `20261106120100_approval_link_flow.sql` | `a099ab3938b46961f9f8bc61094915693574338845bf1b04ab2ac28261bbd51b` | 14400 |
| — | `supabase/verify.sql` (30 blocos) | `e0a2e3c1beff9a3c6914de42d128a6cdf01da1643b08ae0917902e17213e67be` | 14454 |

Recalcule antes de aplicar (o hash vale para o texto com quebras de linha LF). Se o Windows converteu para CRLF, normalize antes de comparar.

## 2. D1 — vários aprovadores

1. `approval_requests` ganha `approver_id` e `submission_id` (a "rodada" de um envio). FK composta `(approver_id, client_id)` para `approvers`. Linhas novas exigem os dois (`CHECK ... NOT VALID`, para não reescrever dado antigo; a tabela está vazia nos projetos atuais).
2. O índice único "uma solicitação aberta por versão" é trocado por **uma aberta por (versão, aprovador)**.
3. **`INSERT` direto de `authenticated` em `approval_requests` é revogado.** O envio é só por `public.submit_for_approval(version, aprovadores[], prazo, recado)`: `SECURITY DEFINER`, só equipe com acesso ao cliente, 1 a 20 aprovadores distintos, ativos e do cliente, prazo futuro, material em rascunho; cria todas as solicitações da rodada numa transação (tudo ou nada) e audita `material.submitted` (ids e contagem, sem texto livre).
4. `app.requests_before_insert` reescrita (aceita várias solicitações da mesma rodada; confere aprovador, versão mais recente e arquivos).
5. **`app.record_decision` reescrita** (único caminho que grava decisão): trava a linha do **material** e depois a da solicitação (ordem global; decisões concorrentes se serializam), exige que a solicitação seja DO aprovador, que o material esteja `aguardando` e que a versão seja a mais recente. **Política:** alteração → material em `alteracao`, demais solicitações abertas da rodada canceladas e seus links revogados; aprovação → o material só vira `aprovado` quando não resta solicitação aberta na rodada. As decisões já gravadas nunca mudam (tabela imutável).
6. `cancel_approval_request` cancela a **rodada inteira**, revoga os links e devolve o material a `rascunho` (somente se estava `aguardando`).
7. `app.version_content` (fonte única do conteúdo apresentado) e `freeze_version_content` reescrita para usá-la. Reenviar a **mesma versão** depois de um cancelamento só é aceito se o conteúdo atual for igual ao congelado; senão: "crie uma nova versão" (o conteúdo congelado nunca muda).
8. Política `requests_select_portal` restrita: cada aprovador lê **só as próprias** solicitações.

## 3. D2 — link rápido com código e sessão

Tudo é executado pelo **servidor** (service_role); nenhuma função abaixo é executável por `anon` nem `authenticated`.

| Função | O que faz |
|---|---|
| `link_resolve(token_hash)` | estado do link (`ok`, `invalid`, `revoked`, `expired`, `used`, `closed`) e, se ok, empresa + e-mail mascarado |
| `link_issue_code(token_hash, code_hash)` | grava o HMAC do código (10 min); 1 código/60 s e 5/hora por link; o anterior deixa de valer |
| `link_verify_code(token_hash, code_hash, session_hash)` | confere o código (máx. **5 tentativas** por código; resposta por status, sem exceção, para o contador persistir) e abre a sessão de 30 min |
| `link_session_context(token_hash, session_hash)` | token + sessão válidos → ids do escopo do link |
| `decide_with_link_session(...)` | **único** caminho de decisão por link; revalida link, solicitação, versão e sessão sob bloqueio |

Também: `create_approval_link` exige que o aprovador seja o **da solicitação**, revoga o link anterior (um ativo por solicitação) e audita; `revoke_approval_link` audita; **`decide_via_link` foi removida** (decidia sem exigir verificação). `app.link_state` é interna. Auditoria nova: `approval_link.created`, `approval_link.revoked`, `approval_link.verified`, `approval_request.cancelled`, `decision.recorded` — só ids, canal e carimbos; **nunca** token, código, e-mail ou texto livre.

## 4. Procedimento de aplicação (quando autorizado)

1. Confirmar projeto, `git status` limpo e hashes acima. 2. Aplicar **D1**, parar e conferir; aplicar **D2**. 3. Rodar `supabase/verify.sql` (30 blocos): **todos em 0**. 4. Conferências: `has_table_privilege('authenticated','public.approval_requests','INSERT')` falso; `decide_via_link` inexistente; as cinco funções `link_*`/`decide_with_link_session` só com `EXECUTE` para `service_role`; `submit_for_approval` só para `authenticated`. 5. No app: definir `APPROVAL_LINK_SECRET`, `SUPABASE_SECRET_KEY` e o provedor de e-mail no ambiente. 6. Rodar a validação operacional com dados fictícios (`MODULO-4.md`, seção 7).

## 5. Reversão de emergência

Nova migration, nunca edição. Só antes de existirem solicitações/decisões que dependam do modelo novo (solicitações com `approver_id`): recriar `decide_via_link` com a verificação de sessão (nunca a versão sem código), devolver o `INSERT` e o índice antigos. Decisões são imutáveis: não há como "desfazer" dado gravado, só desligar o fluxo.
