# Migrations da etapa B (Módulo 3 — Cadastro de Materiais)

Estado em **2026-11-04** (B1 endurecida na revisão de segurança do mecanismo de revisão, seção 6): as duas migrations estão **criadas e testadas localmente** (Postgres em memória com todas as migrations, inclusive as 8 anteriores). **Nenhuma foi aplicada em projeto Supabase algum.** A aplicação depende da **autorização expressa** do usuário, uma migration por vez, no procedimento da seção 3.

O que muda para o app: sem as duas migrations aplicadas, as telas `/admin/materiais` do modo real **falham ao ler** (as colunas `caption`, `aspect_ratio` e `publish_date` ainda não existem no projeto de desenvolvimento). O modo demonstração não é afetado.

## 1. As duas migrations

| # | Arquivo | SHA-256 (16 primeiros, texto com LF) | Bytes |
|---|---|---|---|
| B1 | `20261104120000_materials_content_and_guards.sql` | `e420e0eb9e04cd0b` | 7599 |
| B2 | `20261104120100_audit_materials.sql` | `20bcbff95dbc4279` | 4248 |

`supabase/verify.sql` ficou com **27 blocos** (22 anteriores + 5 da etapa B), SHA-256 `e73f8ac3a484bb08` (11623 bytes).

> A B1 **foi alterada depois do primeiro commit** (`13ce79a`) por causa da revisão da seção 6. Como nunca foi aplicada em projeto algum, a edição é permitida; os hashes acima são os atuais.

### B1 — conteúdo e travas

1. **Colunas novas em `public.materials`:** `caption text not null default ''` (máximo de 2200 caracteres), `aspect_ratio text` (opcional; só `1:1`, `4:5`, `9:16` ou `outro`) e `publish_date date`. `due_date` continua sendo o **prazo de aprovação**.
2. **Grants por coluna (revisados):** o app (`authenticated`) passa a gravar as 3 colunas novas (insert e update). **Continuam fora de qualquer UPDATE do app:** `id`, `project_id`, `client_id`, `type`, `status`, `created_by`, `created_at`, `updated_at`. **Fora de INSERT:** `id`, `status`, `created_at`, `updated_at`. `anon` não tem nada. O `SELECT` é o de tabela que já existia (cobre as colunas novas).
3. **Trava de conteúdo** (`app.materials_guard_content`, BEFORE UPDATE): com `status <> 'rascunho'` (enviado, alteração pedida ou aprovado) **título, descrição, legenda, canal e proporção não mudam** (erro 23514 "material já enviado para aprovação…"), nem para o administrador nem para o `service_role`. As **datas** (`due_date`, `publish_date`) continuam editáveis. A função só compara OLD e NEW (não lê outras tabelas), então não vira oráculo de dados de outros clientes mesmo rodando antes da RLS.
4. **Guarda de cliente arquivado** (`materials_guard_active_client`, BEFORE INSERT): reaproveita `app.guard_active_client()` da A.2; vale também para o `service_role`.
5. **Material aprovado só muda de estado pela operação explícita de revisão** (seção 6): `app.versions_before_insert()` (mesma função da migration 1, com uma regra a mais) recusa criar versão de material `aprovado`, e o gatilho `materials_guard_status` recusa qualquer mudança de `status` de um material `aprovado` (inclusive por `UPDATE` direto do servidor), **a menos que** exista um **tíquete** vinculado ao material, à transação e a quem agiu (`app.revision_tickets`, emitido só por `app.grant_revision_ticket()`). O fluxo já existente (alteração pedida → nova versão → rascunho) não muda.

### B2 — auditoria

`app.audit_row_change()` (A.2) passa a tratar `materials` e **exclusões**: `material.created`, `material.updated` (nomes das colunas alteradas; `status_from`/`status_to` se o status mudou) e `material.deleted` (`status_from`). O `metadata` continua só com `client_id`, `actor_role`, `changed`, `status_from`, `status_to`: **nunca título, legenda nem descrição**. Gatilho `materials_audit_row` (INSERT, UPDATE e DELETE).

## 2. Ordem e dependências

B1 antes de B2 (B2 não depende de B1, mas a ordem mantém os blocos do `verify.sql` coerentes). Ambas dependem das 8 migrations já aplicadas. Nenhuma toca dados existentes: a tabela `materials` tem 0 linhas no projeto de desenvolvimento.

## 3. Procedimento seguro (quando houver autorização)

O mesmo da A.2 (`MIGRACOES-A2.md`, seção 3), uma migration por vez:

1. **Antes (só leitura):** projeto "DB Aprova Luvi" (`kswnwootbdzlhdvbhhpk`); `git status` limpo e os hashes da tabela acima; `select count(*) from public.materials` (esperado 0); `verify.sql` de 22 blocos em 0; os blocos 23 a 25 devolvem linhas (objetos ainda ausentes).
2. **B1:** colar o texto exato, comparar o SHA-256 do editor com o da tabela, executar. Se houver qualquer erro, aviso inesperado ou divergência: **parar e consultar**. Conferir: 3 colunas novas; gatilhos `materials_guard_content` e `materials_guard_active_client`; `app.materials_guard_content` sem `EXECUTE` para `anon`/`authenticated`; `has_column_privilege` do app (seção 1, item 2).
3. **B2:** idem. Conferir: gatilho `materials_audit_row` com INSERT/UPDATE/DELETE; `app.audit_row_change` sem `EXECUTE` para o app.
4. **Depois:** `verify.sql` (27 blocos, cada um dentro de `select count(*) from (…)`): todos em 0; bucket `materials` privado; administrador intacto; nenhum dado criado pela aplicação.
5. **Teste operacional com dados fictícios** ("TESTE B"): cadastrar, editar, listar e filtrar, excluir rascunho vazio, conferir os eventos `material.*` sem título nem legenda.

## 4. Riscos e como foram tratados

| Risco | Tratamento |
|---|---|
| Trocar `app.audit_row_change` e `app.versions_before_insert` (funções já aplicadas) | `create or replace` com o mesmo corpo + a regra nova; os 198 testes de banco anteriores continuam verdes e há testes novos para cada ramo |
| A operação de revisão (etapa D) precisa liberar o material aprovado | Tíquete (`app.revision_tickets`) vinculado a material, transação e usuário, de uso único e emitido só por função interna; o antigo sinal por configuração de sessão **foi removido** (seção 6) |
| Trava de conteúdo não é exercitável no banco real enquanto nenhum material sair de rascunho (Módulo 4) | Provada nos testes de banco, forçando o status pelo servidor |
| Regra "projeto concluído não recebe material" só no servidor | Documentada; pode virar trava de banco depois |

## 5. Reversão de emergência (nova migration, **nunca** edição das aplicadas)

Só antes de existirem materiais ou eventos que dependam delas.

```sql
-- B2: parar de auditar materiais (a função pode manter o ramo; não é chamada sem o gatilho)
drop trigger if exists materials_audit_row on public.materials;

-- B1
drop trigger if exists materials_guard_status on public.materials;
drop trigger if exists materials_guard_content on public.materials;
drop trigger if exists materials_guard_active_client on public.materials;
drop function if exists app.materials_guard_content();
drop function if exists app.materials_guard_status();
drop function if exists app.has_revision_ticket(uuid);
drop function if exists app.grant_revision_ticket(uuid);
drop table if exists app.revision_tickets;
revoke insert (caption, aspect_ratio, publish_date), update (caption, aspect_ratio, publish_date) on public.materials from authenticated;
-- Restaurar app.versions_before_insert() ao corpo da migration 1 (core_schema), sem o ramo "aprovado".
-- Só se a tabela estiver sem dados nessas colunas:
-- alter table public.materials drop column caption, drop column aspect_ratio, drop column publish_date;
```

## 6. Revisão de segurança do mecanismo de revisão (2026-11-04)

**Pergunta:** o sinal `app.revision_in_progress` basta, sozinho, para contornar a proteção de material aprovado?

**Achado:** **sim, bastava** (na primeira versão da B1). Era um nome livre de configuração de sessão: qualquer código que consiga rodar `set_config` na mesma transação o liga, e ele não era vinculado a um material, a quem agiu nem a uma transação. Se algum dia um `set_config(..., false)` (nível de sessão) fosse usado, o sinal vazaria para outras requisições do mesmo pool de conexões. O PostgREST não expõe `set_config` (só funções dos schemas expostos), então a API não alcançava isso; mas essa proteção dependia da configuração da API e não do banco. Também havia um segundo caminho: `UPDATE` direto de `status` por quem tem `service_role` (o gatilho só olhava o conteúdo).

**Correção (B1):**

| Camada | Como funciona |
|---|---|
| Tíquete `app.revision_tickets` | tabela do schema `app` (fora da API), **sem nenhum privilégio** para `anon`, `authenticated` e `service_role`, RLS ligada e nenhuma política. Chave `(material_id, txid)`, com `actor` (`auth.uid()`) |
| Emissão | só `app.grant_revision_ticket(material)`, `SECURITY DEFINER`, **sem `EXECUTE` para ninguém da API** (nem `service_role`); chamada apenas por outra função `SECURITY DEFINER` (a operação de revisão, etapa D). Limpa tíquetes de outras transações |
| Validade | `app.has_revision_ticket(material)`: existe tíquete **deste material**, **desta transação** (`txid_current()`) e **de quem está agindo** (`auth.uid()`, nulo para o servidor) |
| Uso único | `materials_guard_status` consome o tíquete ao mudar de `aprovado` para `rascunho` |
| Nova versão | `versions_before_insert` exige o tíquete se o material está `aprovado` |
| Mudança de status | `materials_guard_status` (BEFORE UPDATE OF status): de `aprovado`, só vai para `rascunho` e só com tíquete; vale para o dono do banco e para o `service_role` |
| Sinal antigo | **removido**: `set_config('app.revision_in_progress', …)` não tem mais efeito (teste cobre nível de transação e de sessão) |

**Resultado:** o antigo sinal **não é suficiente** (nem junto com outro papel); para contornar a proteção é preciso emitir um tíquete, o que só código executando como dono do banco consegue (SQL no painel do projeto, ou uma função `SECURITY DEFINER` escrita e revisada por nós). A operação de revisão (etapa D) é a única que deve chamar `app.grant_revision_ticket`.

**Testes (`materials-b.test.ts`, 7 novos):** o sinal antigo não destrava (dono, designer, sessão); revisão com tíquete cria a v2, volta a rascunho, consome o tíquete e preserva a v1 e seus arquivos; tíquete de outro usuário, de outro material e de outra transação não servem; papéis da API não emitem, consultam nem forjam tíquetes; `UPDATE` direto de status de aprovado é recusado (para o dono e o servidor) e, com tíquete, só vai a rascunho, uma vez; as funções internas não são executáveis por `anon`, `authenticated` nem `service_role`. **Mutações:** sem o gatilho de status falham 3 testes; sem o vínculo com o usuário, 1; sem o vínculo com a transação, 1; com a emissão aberta ao `authenticated`, 2. `verify.sql` ganhou os blocos 26 (tabelas do schema `app` expostas ou sem RLS) e 27 (funções internas executáveis por papel da API), e o bloco 23 inclui o gatilho de status.

**Verificação objetiva do desenho (5 testes, `materials-b.test.ts`, "modelo da operação de revisão"):** uma função `SECURITY DEFINER` de teste, no formato previsto para `start_material_revision` (confere `staff_can_access`, emite o tíquete com `app.grant_revision_ticket` e cria a versão, tudo na mesma transação, com `EXECUTE` só para `authenticated`), prova que: (1) a equipe emite e consome o tíquete na mesma transação e nada sobra na tabela; aprovador, staff de outra organização e anônimo não conseguem; (2) as funções do tíquete e o gatilho de status são `SECURITY DEFINER`, com `search_path` vazio, do **mesmo dono** da tabela, sem `EXECUTE` para a API, e a tabela tem RLS ligada, sem política e sem `FORCE`; (3) mesmo existindo uma função exposta ao app, o usuário comum continua sem emitir nem forjar tíquete, sem alterar status ou conteúdo de material aprovado e sem criar versão por fora dela; (4) depois da revisão, a versão 1, seus arquivos, a solicitação e a decisão ficam **idênticos** (comparação linha a linha) e continuam imutáveis, até para o dono do banco. Nenhuma falha encontrada. Para a etapa D: a função de revisão deve ser a **única** chamadora de `app.grant_revision_ticket`, conferir permissão antes de emitir e ter `EXECUTE` só para `authenticated` e `service_role`.

**Risco residual (aceito e documentado):** quem tem acesso de dono ao banco (SQL Editor do projeto) pode emitir tíquete ou desligar gatilhos; isso é inerente a qualquer proteção no banco e se controla com MFA e acesso mínimo ao painel do Supabase. O mesmo vale para o `app.audit_action` da A.2 (um sinal de sessão que só rotula o evento de auditoria; não protege dados).

## 8. Registro da aplicação (2026-11-05)

B1 e B2 foram **aplicadas no DB Aprova Luvi em 2026-11-05**, uma por vez, com o SHA-256 completo conferido antes de executar, e verificadas no catálogo (colunas, gatilhos, privilégios por coluna, funções sem EXECUTE para a API). O registro completo, com hashes e o `verify.sql` de 28 blocos em 0, está em `MIGRACOES-C.md`, seção 7; a validação operacional, em `MODULO-3.md`, seção 14.
