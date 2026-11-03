# Módulo 3 — Gestão de Materiais: plano e acompanhamento

Estado em **2026-11-02**. Autorizado o início do módulo pelo usuário; **etapa A concluída** (clientes e projetos); as etapas B a F **aguardam autorização**, uma a uma.

## 1. Etapas

| Etapa | Escopo | Estado |
|---|---|---|
| **A** | Clientes (cadastro, edição, listagem, arquivamento) e projetos vinculados a clientes | **Concluída** (este documento) |
| B | Cadastro de materiais: título, legenda, descrição, formato, data prevista de publicação | Não iniciada |
| C | Upload privado e seguro de imagens, vídeos e PDFs; consistência em caso de falha | Não iniciada |
| D | Carrosséis com slides ordenados; histórico de versões sem sobrescrever | Não iniciada |
| E | Dashboard integrado ao Supabase (indicadores com dados reais) | Não iniciada |
| F | Testes e validações de ponta a ponta, relatório do módulo | Não iniciada |

Regras do módulo (valem para todas as etapas): não reconstruir o que existe; preservar a identidade visual; respeitar os papéis; **validar a autorização no servidor**; **nunca usar a chave secreta para contornar a RLS em operações comuns**; não permitir acesso a arquivos de outros clientes; não sobrescrever versões; validar formato e tamanho; manter os registros consistentes se o upload falhar; **dados de demonstração nunca se misturam a dados reais**; só dados fictícios de teste, nunca arquivos de clientes reais; sem migration remota, push, merge ou deploy sem autorização expressa.

## 2. Permissões

"Colaborador" = `designer` e `atendimento`. O banco (RLS) é a barreira final; o servidor repete a checagem em cada Server Action e a tela só oferece o que o papel pode fazer.

| Ação | Administrador | Atendimento | Designer | Aprovador (cliente) |
|---|---|---|---|---|
| Ver clientes e projetos da organização | sim | sim | sim | não (só o portal) |
| Cadastrar, editar, arquivar e reativar clientes | sim | sim | **não** | não |
| Criar e editar projetos | sim | sim | sim | não |
| Apagar cliente ou projeto | **ninguém** (arquivar é `active = false`) | | | |

Referências: `app.can_manage_clients()` (admin e atendimento), `canManageClients()` em `src/lib/auth/roles.ts`, policies `clients_*` e `projects_*` na migration 3.

## 3. O esquema atual suporta a etapa A?

**Sim, sem nenhuma migration.** Conferido contra as migrations aplicadas no projeto de desenvolvimento:

| Fluxo | Suporte |
|---|---|
| Criar cliente | `INSERT` de `organization_id, name, segment, initials, active` para `authenticated`; policy exige `can_manage_clients()` e `organization_id = my_org()` |
| Editar e arquivar cliente | `UPDATE` de `name, segment, initials, active`; a organização do cliente não é editável |
| Criar projeto | `INSERT` de `client_id, name, description, status, due_date, created_by`; a policy exige `created_by = auth.uid()` e `staff_can_access(client_id)` |
| Editar projeto | `UPDATE` de `name, description, status, due_date`; **`client_id` não é editável** |
| Listar com contagens | `projects`, `materials` e `approvers` legíveis pela equipe via RLS |
| Nada é apagado | sem grant de `DELETE` em `clients` e `projects` |
| Isolamento entre organizações | `staff_can_access` e `organization_id = my_org()`; coberto por `src/test/db/` |

### Lacunas (tratadas no app; nenhuma migration criada ou aplicada)

| # | Lacuna | Tratamento hoje | Endurecimento proposto (precisa da sua autorização) |
|---|---|---|---|
| 1 | A policy de `projects` não olha `clients.active`: o banco aceitaria projeto novo em cliente arquivado | A Server Action recusa ("Este cliente está arquivado…") e o formulário só oferece clientes ativos | Trigger `BEFORE INSERT` em `projects` recusando cliente inativo |
| 2 | `unique (organization_id, name)` distingue maiúsculas: "Casa Aurora" e "casa aurora" coexistem | A Server Action compara sem diferenciar maiúsculas | Índice único em `(organization_id, lower(btrim(name)))` |
| 3 | Criar/editar/arquivar cliente e projeto **não gera `audit_events`** (só versões, arquivos e solicitações auditam) | nenhum | Triggers de auditoria (`app.write_audit`) nessas tabelas |

Os três estão registrados como `it.todo` em `src/test/db/clients-projects.test.ts`, para virarem testes quando houver migration.

### Aviso para a etapa B (provável migration)

O pedido de materiais cita **legenda** e **data prevista de publicação**. A tabela `materials` tem `title`, `description`, `type`, `channel` e `due_date`, mas **não tem coluna de legenda**, e `due_date` hoje representa o prazo de aprovação. É provável que a etapa B precise de **uma migration** (por exemplo `caption` e `publish_date`). Isso será proposto no plano da etapa B, **sem aplicar nada sem a sua autorização expressa**.

## 4. O que a etapa A entrega

**Clientes** (`/admin/clientes`)
- Listagem com avatar de iniciais, segmento, número de projetos, materiais aguardando aprovação e aprovadores (somente leitura; o cadastro de aprovadores fica para depois).
- Cadastro e edição em janela (nome, segmento, iniciais; as iniciais são sugeridas a partir do nome, sem acento nem partículas, e editáveis).
- Arquivar e reativar com confirmação (nada é apagado; o cliente arquivado some do portal e não recebe projetos novos).
- Busca por nome e filtro de status (ativos, arquivados, todos), por parâmetros na URL.

**Projetos** (`/admin/projetos`)
- Listagem com cliente, status, descrição, progresso de aprovação e data de entrega.
- Cadastro (cliente, nome, descrição, status, data de entrega opcional) e edição (o cliente não troca).
- Busca por nome, filtro por status e por cliente.

**Transversal**
- Modo real lê só o banco; o modo demonstração segue com dados fictícios, **somente leitura** (sem botões de escrita).
- O aviso amarelo de "dados de demonstração" deixou de ser global: aparece só nas telas que **ainda** leem dados fictícios (dashboard, materiais, histórico, usuários e portal). Clientes e projetos reais não carregam o aviso.
- Falha de carregamento mostra "Tentar de novo" (`error.tsx`) em vez de tela em branco.
- Botão de fechar das janelas em português ("Fechar").

### Arquitetura

| Camada | Arquivos |
|---|---|
| Regras puras (validação, iniciais, filtros, escape de busca) | `src/lib/clients/schema.ts`, `errors.ts`, `selects.ts` |
| Leitura (cliente Supabase **do usuário**, sob RLS) | `src/lib/clients/queries.ts`; adaptador da demonstração em `demo.ts` |
| Autorização das ações | `src/lib/auth/action-guard.ts` (`authorizeStaff`) |
| Server Actions | `src/app/admin/clientes/actions.ts`, `src/app/admin/projetos/actions.ts` |
| Telas e componentes | `src/app/admin/clientes/page.tsx`, `projetos/page.tsx`, `src/components/clients/*`, `form-field.tsx` |
| Aviso e erros | `src/components/interim-data-notice.tsx` (`MockDataNotice`), `src/app/error.tsx`, `src/app/admin/error.tsx` |

Decisões: nenhuma importação da chave secreta nessas áreas (teste `src/test/no-secret-key.test.ts`); toda escrita grava `organization_id` e `created_by` a partir da **sessão do servidor**, nunca do navegador; erros do banco são traduzidos sem vazar nomes de tabela ou restrição.

## 5. Critérios de aceite

| # | Critério | Resultado | Evidência |
|---|---|---|---|
| 1 | Em modo real, as duas telas mostram só dados do banco | Atendido | E2E contra servidor falso: lista começa vazia; demonstração separada por `isDemoMode()` |
| 2 | Admin e atendimento gerenciam clientes; designer só consulta, e a ação direta é recusada no servidor | Atendido | `actions.test.ts` (designer e aprovador recusados sem chamar o banco); `clients-projects.test.ts` (RLS); E2E (designer sem botões) |
| 3 | Qualquer equipe cria projetos de clientes ativos; cliente arquivado recusado | Atendido | `actions.test.ts`; E2E "cliente arquivado não recebe projeto novo" |
| 4 | Nome obrigatório e sem duplicata (sem diferenciar maiúsculas); iniciais derivadas e no formato do banco | Atendido | `schema.test.ts`, `actions.test.ts`, E2E |
| 5 | Busca e filtros por URL | Atendido | `schema.test.ts`, `queries.test.ts`, E2E (demonstração e real) |
| 6 | Nenhum uso da chave secreta | Atendido | `no-secret-key.test.ts` e o módulo `supabase/admin` falha se carregado nas ações |
| 7 | Testes de validação, autorização, ações, banco e E2E; lint, tipos e build | Atendido | seção 6 |
| 8 | Identidade visual preservada | Atendido | só componentes e tokens existentes (cards, badges, `NativeSelect`, `Dialog`, `PageHeader`) |

## 6. Testes

Números exatos na entrega da etapa (ver o relatório). Cobertura:

- **Unitários:** validação e iniciais, filtros da URL, escape de busca, mapeamento de erros do banco, papéis (`schema.test.ts`); montagem das consultas e validação das linhas (`queries.test.ts`).
- **Ações (Supabase falso):** autorização por papel, sessão ausente/indisponível, demonstração, validação, duplicidade, corrida (23505), RLS negando, edição só dos campos permitidos, arquivamento sem `DELETE`, projeto em cliente arquivado (`src/app/admin/actions.test.ts`).
- **Banco (Postgres em memória com as migrations reais):** papéis x RLS x grants para clientes e projetos, isolamento entre organizações, autoria forjada, colunas não graváveis, ausência de `DELETE` (`src/test/db/clients-projects.test.ts`).
- **Componentes:** formulários, confirmação, erros de campo e acessibilidade, cartões, filtros (`src/components/clients/clients-ui.test.tsx`).
- **E2E (Playwright):** demonstração somente leitura com busca e filtros; modo real protegido por login; **10 testes da interface real** contra um servidor falso de Auth e PostgREST (`e2e/support/mock-supabase.mjs`).
- **Consultas contra o banco real, somente leitura:** a sintaxe das consultas com contagens e filtros embutidos foi validada no projeto de desenvolvimento (200; um relacionamento inexistente falha com PGRST200, como controle).

### Limites do que foi provado

- O servidor falso **não prova a RLS nem as constraints**: isso é do teste de banco. Ele prova a interface, as ações, os cookies e a revalidação.
- As **contagens embutidas** (`projects(count)`, `pending:materials(count)` com filtro no alias) foram validadas no banco real só quanto à sintaxe, **com as tabelas vazias**. A semântica com linhas reais deve ser conferida no teste manual abaixo.
- A autenticação do administrador real não foi usada pelo assistente (sem senha): as telas reais foram exercitadas no navegador contra o servidor falso.

## 7. Teste manual sugerido no projeto real (dados fictícios)

Com `npm run dev` e login de administrador:

1. `/admin/clientes`: deve mostrar "Nenhum cliente cadastrado ainda" e **nenhum** aviso amarelo. `/admin` (dashboard) **mantém** o aviso.
2. **Novo cliente** "Cliente Teste Alfa" (segmento qualquer): aparece com as iniciais sugeridas; "1 cliente"; "Nenhum aprovador cadastrado."
3. Tente cadastrar "cliente teste alfa" de novo: deve recusar por duplicidade.
4. **Novo projeto** para o cliente: aparece em `/admin/projetos` com "0 de 0 aprovados"; volte a `/admin/clientes` e confira que o cliente passou a mostrar **1 projeto** (confirma a contagem embutida com dado real).
5. Edite o projeto (status Pausado) e filtre por status e por cliente.
6. Arquive o cliente: some da lista padrão, aparece em "Arquivados"; "Novo projeto" não oferece mais esse cliente; reative.
7. Console do navegador (F12): sem erros vermelhos em nenhuma etapa.
8. Opcional: crie um usuário `designer` (via painel do Supabase/bootstrap) e confira que ele não vê "Novo cliente".

Ao terminar, os dados de teste podem ser arquivados (clientes) ou deixados no banco de desenvolvimento; nada disso vai para produção.

## 8. O que falta

- **Etapa B em diante** (sem iniciar).
- **Cadastro de aprovadores** (`approvers`: nome, e-mail, cargo, ativo). Hoje a tela só os mostra. A RLS já permite à administração e ao atendimento cadastrá-los; é pré-requisito do Módulo 4 (um cliente sem aprovador não aprova nada). **Decisão sua:** incluir como etapa A.2 agora ou no início do Módulo 4.
- Endurecimentos de banco da seção 3 (migration), a seu critério.
- Paginação das listagens (hoje limite de 500 itens, suficiente para o volume esperado).
