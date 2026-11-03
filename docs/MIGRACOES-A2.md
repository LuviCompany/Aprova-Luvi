# Migrations da etapa A.2 — conteúdo e procedimento seguro de aplicação

Estado em **2026-11-03**: as quatro migrations foram **criadas e testadas localmente** (Postgres em memória com todas as migrations) e **aplicadas no projeto de desenvolvimento DB Aprova Luvi** com autorização expressa do usuário, uma por vez (registro e verificações na seção 6). **Não existe projeto de produção**; qualquer novo projeto repete o procedimento da seção 3.

Projeto-alvo: **somente** o de desenvolvimento, **DB Aprova Luvi** (`kswnwootbdzlhdvbhhpk`). Não existe projeto de produção ainda.

## 1. As quatro migrations

SHA-256 (primeiros 16 hex, do arquivo com quebras de linha LF, como o editor do painel o recebe):

| Ordem | Arquivo | SHA-256 | Objetivo |
|---|---|---|---|
| M1 | `20261103120000_integrity_clients_projects.sql` | `15fd17918de5b774` | Banco recusa projeto e aprovador **novos** em cliente arquivado; índice único do nome do cliente **sem diferenciar maiúsculas nem espaços repetidos** |
| M2 | `20261103120100_approvers_multi_client.sql` | `e0e2a6cc12692a91` | Mesmo login em vários clientes (`unique (profile_id, client_id)`); função `link_approver_to_client`; desativar revoga os links pendentes; e-mail do aprovador = e-mail do login |
| M3 | `20261103120200_approver_invites.sql` | `3dd5de9f87bfca4b` | Tabela `approver_invites` (convite **preparado**, sem envio, sem token) e funções `prepare_approver_invite` e `revoke_approver_invite` |
| M4 | `20261103120300_audit_clients_projects_approvers.sql` | `f8c1c6e6c61d3666` | Auditoria (`audit_events`) de clientes, projetos, aprovadores e convites, sem nome nem e-mail |

`supabase/verify.sql`: hash `94824e74bf85018e`, **22 blocos `CHECK`** (16 anteriores + 6 novos da A.2).

### M1 — integridade de clientes e projetos
- **Cria:** função `app.guard_active_client()` (gatilho `BEFORE INSERT`, `SECURITY DEFINER`, `search_path` vazio) ligada a `projects` e `approvers`; índice único `clients_org_name_ci_key` em `(organization_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')))`.
- **Comportamento:** quem não tem acesso ao cliente recebe o erro da RLS (não vaza que o cliente está arquivado). Cliente arquivado recusa o cadastro com `cliente arquivado: …` (código 23514), inclusive para `service_role`. Registros antigos não mudam.
- **Pode falhar se:** já existirem clientes com o mesmo nome nessa regra (a migration inteira desfaz). Acentos continuam sendo diferença ("Casa" ≠ "Cása").

### M2 — aprovador em vários clientes
- **Altera:** remove `approvers_profile_id_key` (unique só de `profile_id`) e cria `approvers_profile_client_key` (`unique (profile_id, client_id)`); `app.approvers_check_profile()` passa a exigir também `lower(btrim(profile.email)) = lower(btrim(approvers.email))`.
- **Cria:** `public.link_approver_to_client(origem, cliente_destino)` (copia nome, e-mail, cargo e login para o cliente de destino; só admin/atendimento; origem ativa; não é o mesmo cliente; o destino precisa estar ativo, o que o gatilho da M1 garante); gatilho `approvers_after_deactivate` (revoga links **não usados e não revogados** do aprovador desativado).
- **Preserva:** decisões, solicitações, comentários e links já usados. Reativar **não** ressuscita link revogado.
- **Atenção:** a troca do `unique` não é reversível sem perda se já houver o mesmo login em mais de um cliente (ver rollback).

### M3 — convites preparados
- **Cria:** tipo `invite_status`; tabela `approver_invites` (RLS ligada na própria migration; a equipe só **lê**; sem grants de escrita); `public.prepare_approver_invite` e `public.revoke_approver_invite`; gatilho que revoga o convite aberto quando o aprovador é desativado.
- **Não faz:** não envia e-mail, não cria usuário no Auth, não emite nem guarda token. O e-mail vem da linha do aprovador.

### M4 — auditoria
- **Cria:** `app.audit_row_change()` e quatro gatilhos `AFTER INSERT OR UPDATE` (`clients`, `projects`, `approvers`, `approver_invites`). Política e retenção: `docs/AUDITORIA.md`.
- **Efeito colateral esperado:** cada gravação nessas tabelas passa a gerar uma linha em `audit_events`.

## 2. Ordem e dependências

M1 → M2 → M3 → M4, **nessa ordem**, cada uma conferida antes da seguinte (M4 audita a tabela criada na M3; M2 usa um marcador de sessão que a M4 lê, mas funciona sem ela).

**Compatibilidade com o código local (que já lê o projeto de dev):**
- Antes da M2: "Vincular pessoa existente" responde "função não existe" (erro tratado, mensagem genérica); a tela do portal com 2 vínculos não ocorre (o unique impede).
- Antes da M3: a tela de detalhe do cliente **funciona sem convites** (tabela inexistente = PGRST205 é tolerada); "Preparar convite" falha com mensagem genérica.
- A tela de detalhe e o cadastro de aprovadores só usam tabelas que já existem.
- Aplicar as quatro migrations **antes** de testar a A.2 no navegador contra o projeto real.

## 3. Procedimento seguro (quando houver autorização)

Quem executa: o usuário no SQL Editor, ou o assistente no navegador do app com o usuário logado, **somente com autorização expressa para cada migration**.

### 3.1 Antes de qualquer migration (somente leitura)
1. `git log -1` e `git status`: conferir o commit que contém as migrations e que a árvore está limpa; conferir os SHA-256 da seção 1 (`tr -d '\r' < arquivo | sha256sum`).
2. Conferir o projeto: título do painel "DB Aprova Luvi" e `ref` `kswnwootbdzlhdvbhhpk`. **Nunca** em outro projeto.
3. Estado atual: `supabase/preflight.sql` não se aplica (o banco já tem as 4 migrations anteriores); rode a consulta de contagem abaixo e guarde o resultado.
   ```sql
   select (select count(*) from public.clients) clientes, (select count(*) from public.projects) projetos,
          (select count(*) from public.approvers) aprovadores, (select count(*) from public.audit_events) eventos,
          (select count(*) from auth.users) usuarios;
   ```
4. Duplicidade que travaria a M1 (deve voltar **vazio**):
   ```sql
   select organization_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) as nome, count(*)
   from public.clients group by 1, 2 having count(*) > 1;
   ```
5. Constraint que a M2 remove (deve voltar 1 linha) e login em mais de um cliente (deve voltar **0**, pois ainda é impossível):
   ```sql
   select conname from pg_constraint where conname = 'approvers_profile_id_key';
   select profile_id, count(*) from public.approvers where profile_id is not null group by 1 having count(*) > 1;
   ```
6. `supabase/verify.sql` (22 blocos): **os 16 primeiros devem dar 0** e os blocos 17 a 22 (A.2) devem apontar objetos **ausentes** (isso confirma que as migrations ainda não foram aplicadas).
7. **Backup:** o projeto de dev tem 0 linhas de negócio (só o administrador) e é descartável. Para **qualquer** projeto com dados reais, fazer backup/exportação **antes** (confirmar no plano contratado o que existe de backup diário/PITR).

### 3.2 Aplicar, uma por vez
Para cada migration, na ordem M1, M2, M3, M4:
1. Colar o conteúdo **exato** do arquivo no SQL Editor e comparar o SHA-256 do texto do editor com o da seção 1 (como foi feito nas migrations 1 a 4 da Fase 2).
2. Executar. O Postgres roda o script numa transação implícita: se der erro, **nada** do arquivo fica aplicado. Se o painel avisar "creates tables without enabling Row Level Security" (a M3 já liga a RLS no próprio arquivo), escolher **"Run without RLS"** para manter o texto revisado.
3. **Se houver qualquer erro, aviso inesperado ou divergência: parar e consultar** (não tentar corrigir sozinho).
4. Conferir no catálogo antes de seguir:

| Depois da | Conferir (somente leitura) |
|---|---|
| M1 | 2 gatilhos `*_guard_active_client`; índice `clients_org_name_ci_key`; função `app.guard_active_client` sem `EXECUTE` para `anon`/`authenticated` |
| M2 | `approvers_profile_client_key` existe e `approvers_profile_id_key` **não**; função pública `link_approver_to_client` (só `authenticated` e `service_role`); gatilho `approvers_after_deactivate` |
| M3 | tabela `approver_invites` com RLS ligada e 1 policy; `authenticated` só com `SELECT`; funções `prepare_approver_invite` e `revoke_approver_invite` |
| M4 | 4 gatilhos `*_audit_row`; função `app.audit_row_change` sem `EXECUTE` para o app |

### 3.3 Depois das quatro
1. Rodar `supabase/verify.sql` (22 blocos) — **todos devem devolver 0 linhas** (como o SQL Editor mostra só o último resultado, embrulhar cada bloco em `select count(*) from (…)`, como na validação anterior).
2. Conferências somente leitura pela API com as chaves atuais: tabela `approver_invites` responde 200; `anon` é barrado em `approver_invites` (401/403).
3. Teste manual no navegador (dados fictícios): cadastrar aprovador; vincular a outro cliente; preparar e cancelar convite; desativar e conferir que os links pendentes caíram; arquivar um cliente e confirmar que projeto e aprovador novos são recusados; confirmar em `audit_events` (como administrador) os eventos, **sem nome nem e-mail**.
4. Registrar o resultado (data, hashes, o que passou ou falhou) em `docs/VALIDACAO-FASE-2.md` ou no documento do módulo.

## 4. Riscos e como foram tratados

| Risco | Tratamento |
|---|---|
| Migration aplicada fora de ordem ou editada | Hashes acima; ordem fixa; migrations aplicadas são **imutáveis** (mudança = migration nova) |
| M1 falhar por nomes duplicados | Consulta de pré-verificação (3.1, item 4); a migration é atômica |
| M2 impedir voltar ao `unique (profile_id)` depois que um login estiver em dois clientes | Rollback só é seguro antes do primeiro vínculo múltiplo (seção 5) |
| M4 aumentar a escrita ou falhar e bloquear gravações | Testes cobrindo insert, update, ator nulo e falha; um evento por operação relevante; sem evento se só `updated_at` muda |
| Dado pessoal na auditoria imutável | Política de **não gravar** nome, e-mail nem texto livre; teste varre o metadata (`docs/AUDITORIA.md`) |
| Gatilho `BEFORE INSERT` virar oráculo entre organizações | Checagem de acesso **antes** da mensagem de cliente arquivado; teste dedicado |
| Funções novas executáveis por `anon` | `revoke` explícito em cada função; `privileges.test.ts` e `verify.sql` reprovam |
| Código local lendo o banco antes das migrations | Seção 2: degradação tratada (convites tolerados; ações com mensagem clara) |
| Chave secreta usada para contornar RLS | Teste estático em `src/test/no-secret-key.test.ts` cobre as áreas novas |
| Portal escolher empresa sozinho | Regra pura `pickPortalContext` + cookie só como preferência, revalidado a cada requisição |

## 5. Rollback de emergência (nova migration, nunca edição das aplicadas)

Só use sob decisão do usuário. Cada item desfaz uma migration; os eventos de `audit_events` já gravados **permanecem** (imutáveis).

```sql
-- Desfaz M4
drop trigger if exists clients_audit_row on public.clients;
drop trigger if exists projects_audit_row on public.projects;
drop trigger if exists approvers_audit_row on public.approvers;
drop trigger if exists approver_invites_audit_row on public.approver_invites; -- se M3 existir
drop function if exists app.audit_row_change();

-- Desfaz M3 (perde os convites registrados)
drop trigger if exists approvers_revoke_open_invites on public.approvers;
drop function if exists app.approvers_revoke_open_invites();
drop function if exists public.revoke_approver_invite(uuid);
drop function if exists public.prepare_approver_invite(uuid);
drop table if exists public.approver_invites;
drop type if exists public.invite_status;

-- Desfaz M2 (SÓ se nenhum login estiver em mais de um cliente; senão o add constraint falha)
drop trigger if exists approvers_after_deactivate on public.approvers;
drop function if exists app.approvers_after_deactivate();
drop function if exists public.link_approver_to_client(uuid, uuid);
alter table public.approvers drop constraint if exists approvers_profile_client_key;
alter table public.approvers add constraint approvers_profile_id_key unique (profile_id);
-- (a função app.approvers_check_profile() fica com a verificação de e-mail; restaurá-la exige create or replace com o texto da migration 1)

-- Desfaz M1
drop trigger if exists projects_guard_active_client on public.projects;
drop trigger if exists approvers_guard_active_client on public.approvers;
drop function if exists app.guard_active_client();
drop index if exists public.clients_org_name_ci_key;
```

## 6. Registro da aplicação no DB Aprova Luvi (2026-11-03)

Executada no SQL Editor do projeto `kswnwootbdzlhdvbhhpk` (título do painel "DB Aprova Luvi"), com autorização expressa do usuário, **uma migration por vez**, na ordem M1 → M4, pelo assistente no navegador do app com o usuário logado. Commit de origem: `91c47ef`.

**Antes (somente leitura):** arquivos SQL idênticos aos do commit (hashes da seção 1); 15 tabelas com RLS, 39 políticas, 22 funções em `app` e 5 em `public`, 0 funções executáveis por `anon`, 0 `SECURITY DEFINER` sem `search_path` vazio, bucket `materials` privado; M1 a M4 ausentes; 0 clientes, projetos, aprovadores e eventos de auditoria (só o administrador); 0 nomes duplicados; `approvers_profile_id_key` presente; 0 logins em mais de um cliente; nenhum projeto da Vercel com variável de Supabase legível apontando para este projeto (o `system` tem variáveis cifradas, não verificável).

| Migration | SHA-256 do texto no editor | Resultado | Conferência depois (catálogo) |
|---|---|---|---|
| M1 | `15fd17918de5b774` | Success | 2 gatilhos `*_guard_active_client`; índice `clients_org_name_ci_key`; função `SECURITY DEFINER`, `search_path` vazio, sem `EXECUTE` para `anon`, `authenticated` e `service_role` |
| M2 | `e0e2a6cc12692a91` | Success | `approvers_profile_client_key (profile_id, client_id)` criada e `approvers_profile_id_key` removida; `link_approver_to_client` só para `authenticated` e `service_role`; gatilho `approvers_after_deactivate`; `approvers_check_profile` com a regra do e-mail; `profile_id` e `email` sem permissão de escrita para o app |
| M3 | `3dd5de9f87bfca4b` | Success | `approver_invites` com RLS, 1 política (`SELECT`), o app só lê, `anon` sem acesso, sem colunas de token, e-mail ou nome; funções `prepare_` e `revoke_approver_invite` fechadas para `anon`; gatilho `approvers_revoke_open_invites` |
| M4 | `f8c1c6e6c61d3666` | Success | 4 gatilhos `*_audit_row`; `audit_row_change` sem `EXECUTE` para o app; `audit_events` imutável, sem escrita pelo app, leitura só do administrador |

Em **cada passo** a regressão foi conferida: nenhuma tabela sem RLS (16 de 16 depois da M3), 40 políticas depois da M3, 0 grants e 0 funções executáveis por `anon`, 0 `SECURITY DEFINER` sem `search_path` vazio, `decide_via_link` só para o servidor.

**Ocorrência na M2:** o hash do texto colado não bateu com o do arquivo na primeira colagem, porque a colagem omitiu a linha em branco final do arquivo (termina em `;` + duas quebras de linha). Nada foi executado; a colagem foi completada até ficar byte a byte igual (4273 bytes, hash `e0e2a6cc12692a91`) e só então executada. O repositório não tinha divergência.

**Depois das quatro:**
- `supabase/verify.sql` (hash `94824e74bf85018e`, 22 blocos, cada um dentro de um `count(*)`): **todos devolveram 0**. O bloco 22 (metadata de auditoria sem dados pessoais) passou com a tabela vazia: ainda não foi exercitado com eventos reais.
- Bucket `materials`: único, privado, 50 MB. Conta administrativa: 1 usuário, `admin@luvicompany.com.br`, confirmado, sem banimento, perfil `admin` ativo; cadastro livre desligado.
- Nenhum dado criado: clientes, projetos, aprovadores, convites e auditoria seguem em 0. Nenhum convite enviado, bootstrap não executado, Auth não alterado.
- API com as chaves atuais: `anon` recebe 401 (permissão negada) em `approver_invites` e nas três funções novas (como no controle `decide_via_link`); o servidor enxerga `approver_invites` (cache de esquema atualizado).

**Teste manual da seção 3.3 (item 3): executado e aprovado em 2026-11-03**, com dados fictícios, no `npm run dev`: 11 testes aprovados, 11 eventos de auditoria sem nome nem e-mail e `verify.sql` 22/22 em 0 com dados (bloco 22 exercitado). Registro em `docs/MODULO-3.md`, seção 11.
