# Migrations da etapa B (Módulo 3 — Cadastro de Materiais)

Estado em **2026-11-04**: as duas migrations estão **criadas e testadas localmente** (Postgres em memória com todas as migrations, inclusive as 8 anteriores). **Nenhuma foi aplicada em projeto Supabase algum.** A aplicação depende da **autorização expressa** do usuário, uma migration por vez, no procedimento da seção 3.

O que muda para o app: sem as duas migrations aplicadas, as telas `/admin/materiais` do modo real **falham ao ler** (as colunas `caption`, `aspect_ratio` e `publish_date` ainda não existem no projeto de desenvolvimento). O modo demonstração não é afetado.

## 1. As duas migrations

| # | Arquivo | SHA-256 (16 primeiros, texto com LF) | Bytes |
|---|---|---|---|
| B1 | `20261104120000_materials_content_and_guards.sql` | `986835bb26938d27` | 4623 |
| B2 | `20261104120100_audit_materials.sql` | `20bcbff95dbc4279` | 4248 |

`supabase/verify.sql` ficou com **25 blocos** (22 anteriores + 3 da etapa B), SHA-256 `a74b0f4820f003bf` (10544 bytes).

### B1 — conteúdo e travas

1. **Colunas novas em `public.materials`:** `caption text not null default ''` (máximo de 2200 caracteres), `aspect_ratio text` (opcional; só `1:1`, `4:5`, `9:16` ou `outro`) e `publish_date date`. `due_date` continua sendo o **prazo de aprovação**.
2. **Grants por coluna (revisados):** o app (`authenticated`) passa a gravar as 3 colunas novas (insert e update). **Continuam fora de qualquer UPDATE do app:** `id`, `project_id`, `client_id`, `type`, `status`, `created_by`, `created_at`, `updated_at`. **Fora de INSERT:** `id`, `status`, `created_at`, `updated_at`. `anon` não tem nada. O `SELECT` é o de tabela que já existia (cobre as colunas novas).
3. **Trava de conteúdo** (`app.materials_guard_content`, BEFORE UPDATE): com `status <> 'rascunho'` (enviado, alteração pedida ou aprovado) **título, descrição, legenda, canal e proporção não mudam** (erro 23514 "material já enviado para aprovação…"), nem para o administrador nem para o `service_role`. As **datas** (`due_date`, `publish_date`) continuam editáveis. A função só compara OLD e NEW (não lê outras tabelas), então não vira oráculo de dados de outros clientes mesmo rodando antes da RLS.
4. **Guarda de cliente arquivado** (`materials_guard_active_client`, BEFORE INSERT): reaproveita `app.guard_active_client()` da A.2; vale também para o `service_role`.
5. **Material aprovado não volta a rascunho por uma nova versão qualquer:** `app.versions_before_insert()` (mesma função da migration 1, com uma regra a mais) recusa criar versão quando o material está `aprovado`, **a menos que** a transação sinalize `app.revision_in_progress = 'on'`. Esse sinal será ligado só pela operação explícita de revisão (seção 12.4 de `MODULO-3.md`), que ainda não existe. O fluxo já existente (alteração pedida → nova versão → rascunho) não muda.

### B2 — auditoria

`app.audit_row_change()` (A.2) passa a tratar `materials` e **exclusões**: `material.created`, `material.updated` (nomes das colunas alteradas; `status_from`/`status_to` se o status mudou) e `material.deleted` (`status_from`). O `metadata` continua só com `client_id`, `actor_role`, `changed`, `status_from`, `status_to`: **nunca título, legenda nem descrição**. Gatilho `materials_audit_row` (INSERT, UPDATE e DELETE).

## 2. Ordem e dependências

B1 antes de B2 (B2 não depende de B1, mas a ordem mantém os blocos do `verify.sql` coerentes). Ambas dependem das 8 migrations já aplicadas. Nenhuma toca dados existentes: a tabela `materials` tem 0 linhas no projeto de desenvolvimento.

## 3. Procedimento seguro (quando houver autorização)

O mesmo da A.2 (`MIGRACOES-A2.md`, seção 3), uma migration por vez:

1. **Antes (só leitura):** projeto "DB Aprova Luvi" (`kswnwootbdzlhdvbhhpk`); `git status` limpo e os hashes da tabela acima; `select count(*) from public.materials` (esperado 0); `verify.sql` de 22 blocos em 0; os blocos 23 a 25 devolvem linhas (objetos ainda ausentes).
2. **B1:** colar o texto exato, comparar o SHA-256 do editor com o da tabela, executar. Se houver qualquer erro, aviso inesperado ou divergência: **parar e consultar**. Conferir: 3 colunas novas; gatilhos `materials_guard_content` e `materials_guard_active_client`; `app.materials_guard_content` sem `EXECUTE` para `anon`/`authenticated`; `has_column_privilege` do app (seção 1, item 2).
3. **B2:** idem. Conferir: gatilho `materials_audit_row` com INSERT/UPDATE/DELETE; `app.audit_row_change` sem `EXECUTE` para o app.
4. **Depois:** `verify.sql` (25 blocos, cada um dentro de `select count(*) from (…)`): todos em 0; bucket `materials` privado; administrador intacto; nenhum dado criado pela aplicação.
5. **Teste operacional com dados fictícios** ("TESTE B"): cadastrar, editar, listar e filtrar, excluir rascunho vazio, conferir os eventos `material.*` sem título nem legenda.

## 4. Riscos e como foram tratados

| Risco | Tratamento |
|---|---|
| Trocar `app.audit_row_change` e `app.versions_before_insert` (funções já aplicadas) | `create or replace` com o mesmo corpo + a regra nova; os 198 testes de banco anteriores continuam verdes e há testes novos para cada ramo |
| Funções das etapas futuras (revisão explícita) dependem do sinal `app.revision_in_progress` | Mesmo modelo de confiança do `app.audit_action` (A.2): o sinal só vale dentro da transação e não é acionável pela API do PostgREST |
| Trava de conteúdo não é exercitável no banco real enquanto nenhum material sair de rascunho (Módulo 4) | Provada nos testes de banco, forçando o status pelo servidor |
| Regra "projeto concluído não recebe material" só no servidor | Documentada; pode virar trava de banco depois |

## 5. Reversão de emergência (nova migration, **nunca** edição das aplicadas)

Só antes de existirem materiais ou eventos que dependam delas.

```sql
-- B2: parar de auditar materiais (a função pode manter o ramo; não é chamada sem o gatilho)
drop trigger if exists materials_audit_row on public.materials;

-- B1
drop trigger if exists materials_guard_content on public.materials;
drop trigger if exists materials_guard_active_client on public.materials;
drop function if exists app.materials_guard_content();
revoke insert (caption, aspect_ratio, publish_date), update (caption, aspect_ratio, publish_date) on public.materials from authenticated;
-- Restaurar app.versions_before_insert() ao corpo da migration 1 (core_schema), sem o ramo "aprovado".
-- Só se a tabela estiver sem dados nessas colunas:
-- alter table public.materials drop column caption, drop column aspect_ratio, drop column publish_date;
```
