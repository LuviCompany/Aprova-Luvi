# Migrations das etapas C e D (arquivos, versões e revisão)

Estado em **2026-11-05**: as duas migrations estão **criadas e testadas localmente** (Postgres em memória com as 12 migrations). **Nenhuma foi aplicada em projeto Supabase algum.** Ordem de aplicação pendente no projeto de desenvolvimento, **uma por vez**: **B1 → B2 → C1 → C2** (as duas primeiras estão em `MIGRACOES-B.md`). Sem elas aplicadas, as telas de materiais, o upload e o dashboard do modo real **não leem o banco de desenvolvimento** (faltam colunas e tabelas). O modo demonstração não é afetado.

## 1. As duas migrations

| # | Arquivo | SHA-256 (16 primeiros, texto com LF) | Bytes |
|---|---|---|---|
| C1 | `20261105120000_material_files_rules.sql` | `7797e0d72bccd254` | 5485 |
| C2 | `20261105120100_version_contents_and_revision.sql` | `0654ad15cc3cde3e` | 7838 |

`supabase/verify.sql` ficou com **28 blocos** (22 da A.2 + 5 da etapa B + 1 destas), SHA-256 `79f3da34a35885cb` (13528 bytes). As migrations da etapa B tiveram o hash atualizado no endurecimento (`MIGRACOES-B.md`).

### C1 — regras dos arquivos e ordenação

1. **`app.material_files_validate`** (gatilho **AFTER INSERT** em `material_files`, depois das CHECKs, das chaves estrangeiras e da RLS, para não mudar as mensagens que os testes antigos esperam): o arquivo só entra na **versão mais recente**, com o material em **rascunho**; o caminho no storage fica sob `{client_id}/{material_id}/` (isolamento por cliente **e** por material); e o tipo do arquivo combina com o do material: imagem, vídeo e PDF têm **um** arquivo (posição 1); carrossel tem de **1 a 10 slides**, cada um imagem ou vídeo. Vale também para o `service_role`. Limites de tamanho e de MIME já existiam (CHECKs e bucket).
2. **`public.reorder_version_files(version, ordem[])`**: reordena os slides de uma versão ainda não enviada, de forma **atômica** (duas fases para não colidir com a unicidade da posição), exigindo a lista **completa** dos arquivos, sem repetir. `SECURITY DEFINER`, exige usuário da equipe com acesso ao cliente; `EXECUTE` só para `authenticated` (nem `anon`).

### C2 — conteúdo congelado por versão e operação de revisão

1. **`public.material_version_contents`**: cópia **imutável** (gatilhos contra UPDATE, DELETE e TRUNCATE, até para o dono) do que o cliente vê de cada versão: título, descrição, legenda, tipo, proporção, canal, datas e a lista de arquivos (posição, tipo, MIME, nome, tamanho, checksum; **sem** caminho nem ids). Uma linha por versão. RLS: equipe lê; aprovador só de versão **enviada** do próprio cliente; o app não tem INSERT, UPDATE nem DELETE.
2. **Quando congela** (`app.freeze_version_content`, sem `EXECUTE` para a API): (a) ao criar a **solicitação de aprovação** (gatilho `requests_freeze_content`): é o que o cliente recebeu; (b) ao criar a **versão seguinte**, a anterior ainda sem cópia é congelada. Depois do envio o conteúdo do material já está travado (B1), então a cópia é fiel. Os campos coincidem com `PRESENTED_FIELDS` (teste compara).
3. **`app.versions_before_insert`** (mesma função da B1) passa a congelar a versão anterior antes de criar a próxima.
4. **`public.start_material_revision(material, motivo)`**: a **operação explícita de revisão**. Aceita material `aprovado` ou com alteração pedida (`alteracao`), sem solicitação aberta, com motivo de **10 a 500** caracteres (gravado na **nota imutável** da nova versão); para `aprovado` emite o **tíquete** (`app.grant_revision_ticket`, B1) na mesma transação; cria a próxima versão, devolve o material a rascunho **sem tocar** em versões, arquivos, solicitações, decisões nem cópias anteriores; audita `material.revision_started` (**sem** o texto do motivo). `SECURITY DEFINER`; `EXECUTE` só para `authenticated`; só equipe com acesso ao cliente (o servidor sem usuário recebe "sem permissão").

## 2. Procedimento de aplicação (quando autorizado)

O da A.2 (`MIGRACOES-A2.md`, seção 3) e da B (`MIGRACOES-B.md`, seção 3), **uma migration por vez, na ordem B1, B2, C1, C2**: conferir projeto "DB Aprova Luvi" (`kswnwootbdzlhdvbhhpk`), `git status` limpo e SHA-256 do texto colado contra as tabelas; parar e consultar em qualquer erro, aviso ou divergência; depois de cada uma, conferir o catálogo; no fim, `verify.sql` (28 blocos, cada um dentro de `select count(*) from (…)`): **todos em 0**. Os blocos 23 a 28 só passam depois das quatro migrations.

**Conferências específicas da C1/C2:** gatilho `material_files_validate` (AFTER INSERT) em `material_files`; gatilho `requests_freeze_content` em `approval_requests`; `material_version_contents` com RLS, 2 políticas de SELECT, sem INSERT/UPDATE/DELETE para o app; as funções `app.freeze_version_content`, `app.requests_freeze_content` e `app.material_files_validate` sem `EXECUTE` para `anon`, `authenticated` e `service_role`; `reorder_version_files` e `start_material_revision` executáveis só por `authenticated`.

## 3. Reversão de emergência (nova migration, nunca edição das aplicadas)

Só antes de existirem versões com cópia e eventos que dependam delas.

```sql
-- C2
drop trigger if exists requests_freeze_content on public.approval_requests;
drop function if exists public.start_material_revision(uuid, text);
drop function if exists app.requests_freeze_content();
-- Restaurar app.versions_before_insert() ao corpo da B1 (sem o congelamento).
-- A tabela material_version_contents é imutável (gatilhos); remover exige desligar os gatilhos de imutabilidade
-- como dono do banco, e só se estiver sem dados:
-- drop table public.material_version_contents; drop function app.freeze_version_content(uuid);

-- C1
drop trigger if exists material_files_validate on public.material_files;
drop function if exists app.material_files_validate();
drop function if exists public.reorder_version_files(uuid, uuid[]);
```

## 4. Riscos e como foram tratados

| Risco | Tratamento |
|---|---|
| Objetos órfãos no storage se o navegador enviar e o servidor não conseguir finalizar | A finalização apaga os objetos do lote em qualquer falha; se a própria limpeza falhar, sobra um objeto sem linha em `material_files`. Sugestão (Fase 4): rotina que apaga objetos sem linha há mais de 24 h |
| Versão vazia se a gravação das linhas falhar logo depois de criar a versão 1 | Antes de gravar, o servidor valida tipo, tamanho, assinatura e limites; falha residual deixa a versão 1 vazia (impede excluir o rascunho). Aceito e documentado |
| `material_files_validate` é AFTER INSERT | Aborta a instrução inteira (mesma transação); as linhas não persistem |
| Checksum SHA-256 informado pelo navegador | Informativo; o servidor confere tamanho e **assinatura** dos primeiros bytes, não relê o arquivo inteiro |
