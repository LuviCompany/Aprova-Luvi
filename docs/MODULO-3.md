# Módulo 3 — Gestão de Materiais: plano e acompanhamento

Estado em **2026-11-02**. Autorizado o início do módulo pelo usuário; **etapa A concluída** (clientes e projetos); as etapas B a F **aguardam autorização**, uma a uma.

## 1. Etapas

| Etapa | Escopo | Estado |
|---|---|---|
| **A** | Clientes (cadastro, edição, listagem, arquivamento) e projetos vinculados a clientes | **Concluída** (este documento) |
| **B** | Cadastro de materiais: título, legenda, descrição, formato (tipo), proporção, canal, datas; exclusão controlada de rascunhos | **Implementada e commitada (`13ce79a`); migrations B1 e B2 NÃO aplicadas; endurecimento da B1 (tíquete de revisão) ainda sem commit** (seção 12) |
| C | Upload privado e seguro de imagens, vídeos e PDFs; consistência em caso de falha | Não iniciada |
| D | Carrosséis com slides ordenados; histórico de versões sem sobrescrever | Não iniciada |
| E | Dashboard integrado ao Supabase (indicadores com dados reais) | Não iniciada |
| F | Testes e validações de ponta a ponta, relatório do módulo | Não iniciada |
| **A.2** | Cadastro de aprovadores (inclusive em vários clientes), preparação de convites, escolha de empresa no portal e endurecimento do banco (cliente arquivado, nome sem diferenciar caixa, auditoria) | **Implementada; migrations M1 a M4 aplicadas no projeto de desenvolvimento em 2026-11-03** (seções 9, 10 e 11; validação operacional com dados fictícios aprovada em 2026-11-03) |

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

---

# 9. Etapa A.2 — Cadastro de aprovadores e integridade do banco (PLANO APROVADO)

Estado em **2026-11-02**. Plano **aprovado pelo usuário com as 7 decisões** (modelo multi-cliente Opção 1 com **seleção explícita de empresa no portal**; M3 de convites incluída, sem e-mail e sem token; auditoria sem nome nem e-mail, mas com responsável, organização, registro, ação e data/hora, e política de retenção documentada; revogação automática de links; e-mail do aprovador = e-mail do login; bloqueio de cliente arquivado também no banco; M1 a M4 criadas e testadas localmente, **sem execução remota**). A seção 10 registra o resultado. A etapa B só começa depois da A.2 e da autorização do usuário.

## 9.1 Estado do banco de desenvolvimento (somente leitura)

`clients`, `projects`, `approvers`, `audit_events` e `materials`: **0 linhas**. Portanto não há dado a migrar nem duplicidade que impeça um índice único novo. Antes de aplicar qualquer migration a conferência será repetida (`select lower(btrim(name)), count(*) … having count(*) > 1` deve voltar vazio).

## 9.2 Revisão do esquema e das policies de `approvers`

| Item | Hoje | Consequência para a A.2 |
|---|---|---|
| Linha por cliente | `approvers` tem `client_id`; `unique (client_id, email)`; `unique (id, client_id)` | Um aprovador **é** o vínculo pessoa-cliente. As decisões referenciam `(approver_id, client_id)` e são imutáveis: não dá para mudar esse modelo sem refazer o histórico |
| Login | `profile_id uuid unique` (opcional, `on delete set null`) | **O `unique` impede o requisito 2**: uma pessoa com login só pode aprovar para **um** cliente |
| Grants do app | `INSERT (client_id, name, email, job_title, active)`; `UPDATE (name, job_title, active)` | Sem `profile_id` (só o servidor liga login) e **sem `UPDATE` de `email`**: o e-mail já é imutável por grant |
| Policies | `select` equipe (`staff_can_access`) e portal (`my_client_ids`); `insert` e `update` exigem `can_manage_clients()` (admin e atendimento) e `staff_can_access(client_id)` | As permissões da A.2 já existem no banco; o designer só lê |
| Cliente arquivado | `insert` não olha `clients.active` (mesma lacuna dos projetos) | Entra no endurecimento |
| Gatilho | `approvers_check_profile`: o perfil precisa ter papel `cliente` e ser da mesma organização | Mantém; proponho exigir também `profile.email = approvers.email` |
| Efeito de `active = false` | `record_decision`, `my_client_ids` e `my_approver_id` já exigem aprovador ativo | A decisão fica bloqueada, mas **links abertos continuam existindo** (ver M2) |
| Unicidade do e-mail entre clientes | só dentro do mesmo cliente | A "mesma pessoa" em vários clientes é identificada por `(organização, lower(email))` |

## 9.3 Requisito 2: aprovador em mais de um cliente

**Opção recomendada (1): uma linha de `approvers` por cliente, ligadas pelo mesmo login.**
- Troca `unique (profile_id)` por `unique (profile_id, client_id)`. Os mesmos `id`, FKs e decisões continuam valendo; o histórico não muda.
- A "pessoa" é agrupada na tela por e-mail dentro da organização ("Marina Prado · Casa Aurora, Vita Nutri").
- Vincular a outro cliente usa a função `public.link_approver_to_client(origem, cliente_destino)` (`SECURITY DEFINER`, só admin e atendimento): copia nome, e-mail, cargo e o `profile_id` da origem para uma nova linha do cliente de destino. É por função porque `profile_id` continua **fora** dos grants do app (só o servidor liga login).
- Ativar e desativar é **por cliente** (uma pessoa pode estar ativa num cliente e inativa em outro).
- Custo: nome e cargo são editados por linha (podem divergir entre clientes; aceitável, o cargo costuma diferir mesmo).

**Opção descartada (2): tabela `people` + tabela de vínculo.** Modelo mais "limpo", mas exige trocar as FKs de `decisions`, `approval_links` e `comments` e reescrever as funções de decisão. Risco alto para um ganho pequeno agora.

**Impacto no portal:** `getPortalContext` (`src/lib/auth/portal-context.ts`) usa `.limit(1).maybeSingle()` por `profile_id`: com dois vínculos devolveria um cliente arbitrário. Na A.2: ordenar por nome do cliente (determinístico) e documentar. O **seletor de cliente do portal** é do Módulo 4 (o portal ainda lê dados fictícios).

## 9.4 Migrations propostas (nada criado; aplicadas uma por vez, só com a sua autorização expressa)

Ordem sugerida, cada arquivo independente e testado em Postgres em memória antes de qualquer aplicação.

### M1 — `…_integrity_clients_projects.sql` (lacunas 1 e 2)

```sql
-- Projeto/aprovador novo só em cliente ATIVO. BEFORE INSERT roda antes da RLS: checar o acesso primeiro
-- (lição do vazamento por gatilho já coberta em rls.test.ts).
create function app.guard_active_client() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not app.staff_can_access(new.client_id) then
    raise exception 'new row violates row-level security policy for table "%"', tg_table_name using errcode = '42501';
  end if;
  if not exists (select 1 from public.clients c where c.id = new.client_id and c.active) then
    raise exception 'cliente arquivado: reative o cliente antes de cadastrar em %', tg_table_name using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function app.guard_active_client() from public, anon;
create trigger projects_guard_active_client  before insert on public.projects  for each row execute function app.guard_active_client();
create trigger approvers_guard_active_client before insert on public.approvers for each row execute function app.guard_active_client();

-- Nome do cliente único por organização, sem diferenciar maiúsculas nem espaços repetidos.
create unique index clients_org_name_ci_key
  on public.clients (organization_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));
```

Notas: o índice antigo `unique (organization_id, name)` permanece (migrations são aditivas). Não trata acentos (`unaccent` não é imutável): "Casa" e "Cása" seguem distintos.

### M2 — `…_approvers_multi_client.sql` (requisitos 2 e 3 e integridade)

- `alter table public.approvers drop constraint approvers_profile_id_key;` e `create unique index approvers_profile_client_key on public.approvers (profile_id, client_id) where profile_id is not null;`
- `public.link_approver_to_client(p_source_approver_id uuid, p_client_id uuid) returns uuid` (`SECURITY DEFINER`, `search_path` vazio, `can_manage_clients()` e `staff_can_access` nos dois clientes, origem ativa; `revoke … from public, anon`; `grant execute … to authenticated, service_role`).
- `app.approvers_after_deactivate()` (`AFTER UPDATE OF active`, quando `old.active and not new.active`): **revoga os links abertos** (`approval_links.revoked_at = now()` onde `used_at is null and revoked_at is null`), para que desativar uma pessoa derrube também os links já enviados.
- `create or replace function app.approvers_check_profile()` acrescentando `p.email = new.email` (o login e o aprovador precisam ser da mesma pessoa).

### M3 — `…_approver_invites.sql` (requisito 6, **opcional**, pode ficar para depois)

Tabela `approver_invites` (`id`, `approver_id`, `client_id` com FK composta para `approvers`, `status` enum `preparado|enviado|aceito|revogado|expirado`, `prepared_by`, `prepared_at`, `sent_at`, `accepted_at`, `revoked_at`, `expires_at`), com **no máximo um convite aberto por aprovador** (índice único parcial em `preparado|enviado`), RLS (a equipe lê; **sem** grants de escrita ao app) e duas funções: `public.prepare_approver_invite(p_approver_id)` (só admin e atendimento, só para aprovador **ativo e sem login**, cria `preparado`) e `public.revoke_approver_invite(p_invite_id)`. As transições `enviado` e `aceito` ficam para o `service_role` (Fase 3, com Resend e SMTP). **Não guarda token nem e-mail** (o e-mail vem do aprovador; o token será do Supabase Auth). Nenhum e-mail é enviado.

### M4 — `…_audit_clients_projects_approvers.sql` (lacuna 3)

- Função de gatilho `app.audit_row_change()` (`SECURITY DEFINER`, `search_path` vazio) ligada por `AFTER INSERT OR UPDATE` a `clients`, `projects`, `approvers` (e `approver_invites`, se a M3 for adotada), chamando `app.write_audit` (o ator é `auth.uid()`; `service_role` fica com ator nulo).
- Ações: `client.created`, `client.updated`, `client.archived`, `client.reactivated`, `project.created`, `project.updated`, `approver.created`, `approver.updated`, `approver.deactivated`, `approver.reactivated`, `approver.linked` (e `approver_invite.prepared` e `approver_invite.revoked`).
- **Minimização de dados pessoais:** a auditoria é **imutável**, então não grava nome nem e-mail. Guarda `entity_id`, a lista de **colunas** alteradas e, só para `active` e `status`, o valor anterior e o novo. Atualizações que só mexem em `updated_at` não geram evento.
- A leitura continua restrita a administradores (policy existente). Nenhuma tela de auditoria nesta etapa (Fase 4).

### Verificação de cada migration

`supabase/verify.sql` ganha blocos para as funções novas (`SECURITY DEFINER` com `search_path` vazio, nenhuma executável por `anon`, só as RPCs esperadas para `authenticated`), para o índice e para os gatilhos; `src/test/db/privileges.test.ts` passa a conhecer `public.link_approver_to_client` (e as RPCs de convite, se M3) na lista de funções permitidas.

## 9.5 Funcionalidades da A.2 (aplicação)

1. **Detalhe do cliente** `/admin/clientes/[id]` (novo; o cartão em `/admin/clientes` ganha o link): dados do cliente, **aprovadores do cliente** (requisito 4) e projetos dele.
2. **Cadastro e edição de aprovadores** (requisito 1): nome, e-mail (minúsculas, validado), cargo. O e-mail **não muda depois de criado** (histórico imutável); para corrigir, desativa-se o vínculo e cadastra-se o correto.
3. **Vincular pessoa já cadastrada** (requisito 2): lista as pessoas da organização que ainda não estão neste cliente e chama `link_approver_to_client`. Cada cartão mostra "Também aprova para: …".
4. **Ativar e desativar** (requisito 3), por cliente, com confirmação que avisa que links abertos serão revogados.
5. **Status de acesso** por aprovador: "Só por link (sem login)", "Convite preparado — não enviado" (se M3) e "Com acesso ao portal" (`profile_id` ligado). Botões "Preparar convite" e "Cancelar convite" (requisito 6, **sem enviar e-mail**; o envio fica para a Fase 3).
6. **Permissões** (requisito 5): Server Actions com `authorizeStaff({ manageClients: true })` + RLS e funções do banco. O designer vê a lista, sem botões de escrita. O cliente (portal) não acessa o painel.
7. **Demonstração:** a tela de detalhe existe somente leitura, com os dados fictícios.

Novas Server Actions: `saveApproverAction`, `setApproverActiveAction`, `linkApproverAction` e, se M3, `prepareInviteAction` e `cancelInviteAction`. Nenhuma usa a chave secreta (o teste `no-secret-key` continua vigiando `src/app/admin`).

## 9.6 Impacto nas funcionalidades já implementadas

| Área | Impacto | Ajuste |
|---|---|---|
| `saveProjectAction` | Continua com a checagem prévia (boa mensagem no campo); o banco passa a recusar também | Mapear o erro `23514` "cliente arquivado" em `messageForDbError` |
| Duplicidade de cliente | O banco passa a barrar "casa aurora"; a Server Action já barra antes | Sem mudança de comportamento; o teste de corrida (23505) já existe |
| 3 `it.todo` de `clients-projects.test.ts` | Viram testes reais | Substituir |
| `ClientCard` | A lista de aprovadores vira resumo + link para o detalhe | Ajustar `clients-ui.test.tsx` |
| `queries.ts` e E2E com servidor falso | Novas consultas de aprovadores e RPC | Estender `mock-supabase.mjs` e `selects.ts`; revalidar a sintaxe contra o banco real (só leitura) |
| Testes de banco existentes | A auditoria nova passa a gerar eventos no `seedBase`; "só administradores leem a auditoria" (`rls.test.ts`) continua verdadeiro; `privileges.test.ts` e `verify-sql.test.ts` precisam das novas funções | Ajustes mapeados; nenhum comportamento existente muda |
| `getPortalContext` | Com vários vínculos devolveria um cliente arbitrário | Ordenação determinística agora; seletor no Módulo 4 |
| `bootstrap-admin.mjs` | Cria só o administrador | Sem impacto |
| Produção e `main` | — | Nada é tocado |

## 9.7 Critérios de aceite

1. Admin e atendimento cadastram, editam e (des)ativam aprovadores de um cliente **ativo**; o designer só vê; aprovador de cliente e anônimo não acessam (servidor **e** banco).
2. Uma pessoa (mesmo e-mail e, se houver, o mesmo login) pode ser aprovadora de vários clientes **da mesma organização**, nunca de outra; desativar num cliente não afeta os outros.
3. Desativar um aprovador impede a decisão por portal e por link e **revoga os links abertos** dele.
4. Projeto ou aprovador novo em cliente arquivado é **recusado pelo banco**, mesmo por chamada direta (não só pela tela).
5. "Casa Aurora" e "casa  aurora" são o mesmo nome para o banco; o erro chega ao usuário no campo nome.
6. Criar, editar, arquivar e reativar cliente e projeto, e criar, editar, (des)ativar e vincular aprovador geram `audit_events` imutáveis, **sem nome nem e-mail**, legíveis só por administradores.
7. O e-mail do aprovador não muda; login e aprovador têm o mesmo e-mail.
8. Preparar convite não envia nada, não cria usuário no Auth e não guarda token (se M3 for adotada).
9. Nenhuma funcionalidade da etapa A regride: suíte inteira (unitários, banco, componentes, E2E) verde, lint, tipos e build limpos.
10. Validação no banco real, **após autorização**: `verify.sql` (com os blocos novos) todos em 0 e consultas somente leitura confirmadas.

## 9.8 Testes planejados

- **Banco (Postgres em memória com as migrations reais):** matriz de papéis para aprovadores (admin, atendimento, designer, aprovador, anônimo, outra organização); mesmo login em dois clientes e bloqueio em outra organização; `link_approver_to_client` (permissões, origem inativa, cliente arquivado, e-mail repetido no destino); desativação revogando links e bloqueando `decide_via_link` e `decide_as_approver`; guarda de cliente arquivado em projetos e aprovadores (inclusive via função e como `service_role`); índice sem diferenciar caixa e espaços; auditoria (ação certa, ator, ausência de nome e e-mail, sem evento para mudança só de `updated_at`, ilegível para quem não é admin, imutável); convites (um aberto por aprovador, só aprovador sem login, sem escrita direta). Os três `it.todo` viram testes. `verify.sql` e `privileges.test.ts` atualizados.
- **Unitários:** validação de aprovador (nome, e-mail normalizado, cargo), agrupamento por pessoa, estados de acesso.
- **Ações (Supabase falso):** autorização por papel, sessão e demonstração, validação, e-mail repetido, cliente arquivado, vínculo, desativação, convite preparado sem efeito externo.
- **Componentes e E2E (servidor falso estendido):** cadastro, edição, vínculo a outro cliente, desativação, designer sem botões, status de acesso.
- **Banco real, somente leitura:** sintaxe das novas consultas; depois da autorização, `verify.sql`.

## 9.9 Decisões que preciso de você

1. **Modelo multi-cliente:** aprovar a Opção 1 (linha por cliente, login compartilhado, vínculo por função)?
2. **Convites:** incluir a M3 (`approver_invites`, só registra "preparado") agora, ou adiar e mostrar apenas o status derivado de `profile_id`? Recomendo incluir, como arquivo separado.
3. **Auditoria:** aprovar a regra de **não gravar nome nem e-mail** (só ids, colunas e `active`/`status`)?
4. **Revogação automática** dos links abertos ao desativar um aprovador: aprovar?
5. **E-mail do aprovador = e-mail do login** como regra de banco: aprovar?
6. **Guarda de cliente arquivado também para novos aprovadores** (além dos projetos): aprovar?
7. **Aplicação das migrations:** uma por vez no projeto de desenvolvimento, com conferência do hash, `verify.sql` depois de cada uma e só com a sua autorização expressa a cada passo.


---

# 10. Etapa A.2 — resultado da implementação (2026-11-02)

**Implementada e testada localmente; commit `91c47ef`. As migrations M1 a M4 foram aplicadas no projeto de desenvolvimento em 2026-11-03**, uma por vez, com `verify.sql` (22 blocos) em 0 (`docs/MIGRACOES-A2.md`, seção 6). A validação operacional com dados fictícios foi **aprovada em 2026-11-03** (seção 11).

## 10.1 O que foi entregue

- **Migrations (4):** conteúdo, hashes, ordem, riscos, procedimento seguro e rollback em [`MIGRACOES-A2.md`](MIGRACOES-A2.md); auditoria e retenção em [`AUDITORIA.md`](AUDITORIA.md).
- **Detalhe do cliente** `/admin/clientes/[id]`: aprovadores, projetos e ações do cliente; o cartão em `/admin/clientes` leva a ele.
- **Aprovadores:** cadastro e edição (e-mail normalizado e imutável), ativação e desativação **por cliente**, vínculo de uma pessoa já cadastrada a outro cliente (`link_approver_to_client`), status de acesso (só link, convite preparado, com acesso ao portal) e convites **preparados** (nenhum e-mail enviado, nenhum token emitido).
- **Portal:** seleção **explícita** de empresa quando há mais de um vínculo ativo (`CompanyPicker`); troca pelo cabeçalho (`CompanySwitcher`); a escolha é validada **no servidor** contra os vínculos lidos pela RLS; o cookie guarda só a preferência (httpOnly, SameSite, só em `/portal`), é ignorado se não for um vínculo atual e é apagado ao sair. O sistema **nunca** escolhe "o primeiro vínculo".
- **Permissões:** Server Actions com `authorizeStaff({ manageClients: true })` + RLS e funções do banco; designer só consulta; nenhuma operação usa a chave secreta (teste estático ampliado para as áreas novas).
- **Demonstração:** detalhe do cliente somente leitura, com dados fictícios.

## 10.2 Arquivos

**Criados (29):** os documentos `docs/AUDITORIA.md` e `docs/MIGRACOES-A2.md`; as 4 migrations (`supabase/migrations/20261103120000…120300`); `src/lib/approvers/{schema,people,queries,demo}.ts`; `src/lib/auth/{portal-selection,portal-cookie}.ts`; `src/app/admin/clientes/[id]/{page.tsx,actions.ts}`; `src/app/portal/actions.ts`; `src/components/approvers/{approver-card,approver-form-dialog,approver-actions,confirm-action-dialog,link-approver-dialog}.tsx`; `src/components/portal/{company-picker,company-switcher}.tsx`; e os testes `src/test/db/approvers-a2.test.ts`, `src/app/admin/approvers-actions.test.ts`, `src/app/portal/actions.test.ts`, `src/lib/approvers/{approvers,queries}.test.ts`, `src/components/approvers/approvers-ui.test.tsx`, `src/components/portal/portal-company.test.tsx`.

**Modificados (30):** `supabase/verify.sql` (22 blocos), `src/test/db/privileges.test.ts` e demais testes de banco (timeouts), `src/lib/auth/portal-context.ts`, `src/app/portal/layout.tsx`, `src/components/portal/portal-shell.tsx`, `src/app/login/actions.ts` (sair limpa a empresa escolhida), `src/lib/clients/{errors,selects}.ts`, `src/lib/auth/action-guard.ts`, `src/lib/env.ts`, `src/components/clients/{client-card,project-form-dialog}.tsx`, ações de clientes e projetos (revalidação), `vitest.config.mts`, `e2e/*` (servidor falso ampliado e 14 testes novos), `docs/*`.

## 10.3 Testes

| Verificação | Resultado |
|---|---|
| Lint e `tsc` | Limpos |
| Vitest (suíte inteira em paralelo) | **511 aprovados em 32 arquivos** |
| — banco (Postgres em memória, 8 migrations) | 198 em 8 arquivos; **38 novos da A.2** (M1: guarda e nome sem caixa; M2: vários clientes, e-mail do login, função de vínculo, desativação revogando links e preservando decisões; M3: convites; M4: auditoria sem dado pessoal, ator, imutabilidade, rollback) |
| — ações, consultas, regras e componentes novos | 17 (aprovadores) + 6 (portal) + 18 + 7 + 12 + 6 |
| Prova de que os testes não são vazios | Retirando a M1, a M2 ou a M4 do conjunto, 5, 12 e 8 testes da A.2 falham |
| Build de produção isolado | 19 rotas, sem avisos |
| E2E (Playwright, 3 servidores) | **83 de 83** (66 anteriores + 17 novos: 14 da interface real da A.2, 1 do detalhe na demonstração e 2 de rota protegida) |
| Consultas novas contra o banco real, só leitura | Detalhe, aprovadores (com `clients(name)`) e vínculos do portal (alias `client:clients(name)`): válidas. `approver_invites` só existirá depois da M3 (PGRST205 hoje, tolerado pela tela) |

Notas: o servidor falso do E2E **não prova a RLS** (isso é do teste de banco); o Next 16 mantém a página anterior montada e oculta ao navegar, então os testes usam localizadores de elementos visíveis; subi os limites de tempo do Vitest (`testTimeout` 20 s, `hookTimeout` 180 s) porque cada arquivo de banco aplica as migrations e a suíte inteira roda em paralelo.

## 10.4 Riscos identificados

1. **Ordem de aplicação:** o código local já lê o projeto de dev; antes da M3 a tela de detalhe funciona sem convites (tolerado), mas `link`/`prepare` só funcionam depois da M2/M3. Aplicar as quatro antes de testar a A.2 no navegador contra o projeto real.
2. **M2 é a única de reversão delicada:** voltar ao `unique (profile_id)` só é possível antes de o primeiro login ser vinculado a dois clientes.
3. **Hoje, no portal, as telas ainda leem dados fictícios** (Módulo 4): a escolha de empresa é real, o conteúdo ainda não. O aviso de demonstração continua no portal.
4. **E-mail do aprovador imutável:** corrigir um e-mail errado exige desativar o vínculo e cadastrar de novo (decisão deliberada, por causa do histórico e do login).
5. **Convites só registram intenção:** nenhum acesso é concedido e o envio depende de SMTP/Resend (Fase 3); a transição `enviado`/`aceito` é do `service_role`.
6. **Auditoria sem dados pessoais:** para ver o valor de um campo é preciso consultar o registro; o expurgo por prazo é procedimento excepcional (`AUDITORIA.md`).
7. **Instabilidade de rede local** (`DIAGNOSTICO-REDE.md`) pode atrapalhar a aplicação e o teste manual contra o Supabase.
8. **Equipe pequena:** designer vê e-mails de aprovadores (leitura permitida pela RLS); o portal permite ao aprovador ver colegas do mesmo cliente (`approvers_select_portal`), decisão herdada da migration 3 a rever no Módulo 4.

## 10.5 Critérios de aceite da A.2 (seção 9.7) e das decisões

| # | Critério | Resultado | Evidência |
|---|---|---|---|
| 1 | Admin/atendimento cadastram, editam e (des)ativam aprovadores de cliente ativo; designer só vê; aprovador e anônimo não acessam (servidor **e** banco) | Atendido | `approvers-actions.test.ts`, `approvers-a2.test.ts`, E2E |
| 2 | Mesma pessoa em vários clientes da mesma organização, nunca de outra; desativar num não afeta o outro | Atendido | testes de banco da M2 e E2E |
| 3 | Desativar impede decidir por portal e por link e **revoga os links pendentes**, preservando as decisões | Atendido | teste de banco da M2 |
| 4 | Projeto e aprovador novos em cliente arquivado recusados **pelo banco** (inclusive service_role) | Atendido | testes da M1 |
| 5 | "Casa Aurora" = "casa  aurora" no banco; erro chega ao campo nome | Atendido | testes da M1 e da ação |
| 6 | Auditoria de criar, editar, arquivar, reativar, vincular e convites, sem nome nem e-mail, só admin lê | Atendido | testes da M4 |
| 7 | E-mail do aprovador imutável e igual ao do login (comparação normalizada); login não vincula a outro e-mail | Atendido | testes da M2 (grants e gatilho) |
| 8 | Preparar convite não envia nada, não cria usuário nem token | Atendido | M3 sem colunas de token/e-mail; ação só chama a função |
| 9 | Nenhuma regressão da etapa A; suíte inteira verde | Atendido | seção 10.3 |
| 10 | Validação no banco real após autorização | **Atendido** (2026-11-03) | `verify.sql` 22/22 em 0; `MIGRACOES-A2.md` seção 6. Auditoria exercitada com 11 eventos reais (seção 11) |
| P | Portal: seleção explícita de empresa, validada no servidor sob RLS, sem escolher o primeiro vínculo | Atendido | `approvers.test.ts` (`pickPortalContext`), `portal/actions.test.ts`, E2E (cookie adulterado ignorado) |

---

# 11. Etapa A.2 — validação operacional com dados fictícios (2026-11-03)

**Resultado: 11 de 11 testes aprovados, nenhuma falha, nenhuma correção necessária.** Executada por Claude no navegador do app, com a sessão do administrador aberta pelo usuário (o assistente não digita senhas), contra o projeto de desenvolvimento **DB Aprova Luvi** (`kswnwootbdzlhdvbhhpk`) com o `npm run dev` local. Os passos 1 a 8 usaram **a interface administrativa**; os passos 9 a 11 usaram **consultas somente de leitura** no SQL Editor. Roteiro de referência: `MIGRACOES-A2.md`, seção 3.3. Nenhuma migration foi executada, nenhum convite foi enviado, nenhum login de terceiros foi criado, nada foi excluído; sem push, merge ou deploy.

## 11.1 Os 11 testes operacionais

| # | Teste | Resultado | Evidência |
|---|---|---|---|
| 1 | Cadastro e persistência de dois clientes fictícios | **Aprovado** | "TESTE A2 Casa Aurora" e "TESTE A2 Studio Vento" na lista e no banco (`clients` = 2, ambos ativos) |
| 2 | Projetos vinculados aos clientes | **Aprovado** | "TESTE A2 Campanha Verao" (Casa Aurora) e "TESTE A2 Lancamento Inverno" (Studio Vento); `projects` = 2 |
| 3 | Nome duplicado com caixa e espaços | **Aprovado** | `  teste a2   CASA   aurora ` recusado: "Já existe um cliente com esse nome." (nenhum terceiro cliente criado) |
| 4 | Cadastro de um aprovador de teste | **Aprovado** | "TESTE A2 Pessoa Aprovadora", e-mail `@teste.invalid`, status "Só por link (sem login)" |
| 5 | Mesmo aprovador em dois clientes | **Aprovado** | vínculo ao Studio Vento pela ação "Vincular pessoa existente"; a tela mostra "Também aprova para: TESTE A2 Casa Aurora"; `approvers` = 2 (uma linha por cliente) |
| 6 | Desativar um vínculo sem afetar o outro | **Aprovado** | vínculo do Studio Vento "Inativo"; o da Casa Aurora segue "Ativo". Um convite **preparado** (não enviado) nesse vínculo passou a `revogado` sozinho, pelo gatilho da desativação |
| 7 | Cliente arquivado bloqueia projeto e aprovador novos | **Aprovado** | com o cliente arquivado, os formulários (deixados abertos em outras abas) foram enviados e recusados: "Este cliente está arquivado. Reative-o antes de cadastrar aprovadores." e "…antes de criar projetos."; nada foi criado |
| 8 | Reativação do cliente | **Aprovado** | a Casa Aurora voltou a ter "Novo projeto" e "Novo aprovador" |
| 9 | Eventos de auditoria | **Aprovado** | 11 eventos, todos com o administrador como autor (ver 11.3) |
| 10 | Ausência de nome e e-mail na auditoria | **Aprovado** | busca textual por `@`, "teste", "aurora", "vento", "aprovad", "pessoa" no `metadata`: **0**; chaves existentes: só `actor_role`, `changed`, `client_id`, `status_from`, `status_to`; `ip_hash` vazio |
| 11 | Permissões e RLS preservadas | **Aprovado** | `verify.sql` 22/22 em 0 e comportamento por papel (ver 11.2 e 11.4) |

O convite preparado e a revogação **não** fazem parte dos 11 pedidos: foram executados a mais, do roteiro 3.3, e não enviam e-mail (a tela avisa).

## 11.2 As 22 verificações SQL

`supabase/verify.sql` (22 blocos `-- CHECK:`), cada bloco embrulhado em `select count(*) from (…)`: **os 22 devolveram 0 linhas**, agora **com dados**. O texto executado teve o SHA-256 conferido contra o gerado a partir do arquivo do repositório antes da execução. O bloco 22 (metadata de auditoria sem dado pessoal), que na aplicação das migrations tinha passado com a tabela vazia, **passou com os 11 eventos reais**.

## 11.3 Os 11 eventos de auditoria criados

`client.created` ×2 · `project.created` ×2 · `approver.created` · `approver.linked` · `approver_invite.prepared` · `approver.deactivated` · `approver_invite.revoked` · `client.archived` · `client.reactivated`.

Todos com `actor_profile_id` preenchido (o administrador), `actor_approver_id` vazio, `ip_hash` vazio e `metadata` só com ids e nomes de colunas: `client_id`, `actor_role`, `changed` (por exemplo `["active"]`) e, na revogação do convite, `status_from = preparado` e `status_to = revogado`.

## 11.4 Permissões e RLS (consultas de leitura num bloco que termina em erro proposital, sem gravar nada)

| Papel simulado | Resultado |
|---|---|
| `anon` | `permission denied` (42501) em `clients`, `projects`, `approvers`, `approver_invites` e `audit_events` |
| `authenticated` **sem perfil** (sessão sem `sub` de perfil) | 0 linhas em todas as cinco tabelas (a RLS filtra) |
| `authenticated` como o administrador | `clients` 2, `projects` 2, `approvers` 2, `approver_invites` 1, `audit_events` 11 |
| Administrador, escrita direta | negadas (42501): inserir e apagar em `audit_events`, inserir em `approver_invites`, alterar `approvers.profile_id` e alterar `approvers.email` |

Depois do bloco, as contagens seguiam idênticas (2, 2, 2, 1, 11).

## 11.5 Limitações identificadas

1. **Papéis sem teste com usuários reais.** Só existe o administrador no Auth e nenhum outro login foi criado (por regra). **Designer, atendimento e aprovador/cliente não foram testados com usuários reais**: o isolamento entre eles segue provado apenas pelos **198 testes de banco** (Postgres em memória), e a simulação acima cobre só anônimo, autenticado sem perfil e administrador. Recomenda-se repetir um teste mínimo com um usuário de cada papel quando houver convite real (Fase 3, com SMTP).
2. **A recusa do banco não foi exercitada isoladamente.** As mensagens dos testes 3 e 7 vêm da Server Action; não é possível saber, pela interface, se foi ela ou o banco que recusou. A guarda `*_guard_active_client` e o índice `clients_org_name_ci_key` **existem** (blocos 19 e 20) e são exercitados pelos testes de banco, mas não tentei burlar o app (escrever fora dele) no banco real.
3. **Portal e login do aprovador não exercitados** (nenhum aprovador de teste tem login): a escolha de empresa por mais de um vínculo continua provada só por testes automatizados e E2E com servidor falso.
4. **Convite só registra intenção:** o envio (`enviado`/`aceito`) depende de SMTP/Resend (Fase 3) e de `service_role`.
5. **Observação de baixa prioridade, não confirmada:** nas recusas do teste 7 os campos dos formulários apareceram vazios, ao passo que no teste 3 o texto digitado permaneceu. Provavelmente é efeito de eu ter preenchido os campos por script (não digitando); vale conferir à mão na Etapa B.
6. **Iniciais:** os dois clientes ficaram com "TA", derivadas do prefixo "TESTE A2" (comportamento esperado).

## 11.6 Dados fictícios que permanecem no banco de desenvolvimento

Por decisão do usuário, **nada foi excluído**. Ficam no DB Aprova Luvi: 2 clientes (ambos ativos), 2 projetos, 2 aprovadores (mesma pessoa, uma linha por cliente; a do Studio Vento **inativa**), 1 convite `revogado` e **11 eventos de auditoria**. Os eventos são **imutáveis** (gatilhos e falta de grant): o app não consegue apagá-los, e o expurgo seria procedimento excepcional (`AUDITORIA.md`). O app também não exclui clientes, projetos nem aprovadores (só arquivar/desativar). Todos usam o prefixo "TESTE A2" e e-mails `@teste.invalid`; nenhum dado real. As consultas avulsas rodaram no SQL Editor sem salvar nada além de um rascunho de consulta privado do próprio painel.

---

# 12. Etapa B — Cadastro de materiais (implementada em 2026-11-04; migrations NÃO aplicadas)

**Estado:** implementada e testada localmente; commitada em `13ce79a`, **exceto o endurecimento da B1** (tíquete de revisão, seção 12.2 e `MIGRACOES-B.md`, seção 6), que aguarda autorização de commit. As duas migrations (B1 e B2, `MIGRACOES-B.md`) **não foram aplicadas** em nenhum projeto Supabase: até a aplicação, as telas `/admin/materiais` do modo real não leem o projeto de desenvolvimento (faltam as colunas novas). Nada de upload, carrossel, versões, aprovação ou notificações foi implementado.

## 12.1 Decisões aprovadas (e como ficaram)

| # | Decisão | Implementação |
|---|---|---|
| 1 | Tipos `imagem`, `carrossel`, `video`, `pdf` + proporção opcional | coluna `aspect_ratio` (`1:1`, `4:5`, `9:16`, `outro`; vazio = não informada), CHECK no banco, seletor no formulário. O tipo **não** muda depois de criado (sem grant de UPDATE): o remédio é excluir o rascunho vazio e recriar |
| 2 | Legenda em `materials` na B; cópia imutável por versão na D; arquitetura para os demais metadados | seção 12.3 |
| 3 | Conteúdo travado depois de enviado/aprovado; **sem** voltar a rascunho por simples nova versão; operação explícita de revisão | trava no banco (B1) e a regra em `app.versions_before_insert`; operação de revisão **planejada** (12.4), não implementada |
| 4 | Excluir só rascunho vazio, com confirmação e auditoria | RLS (rascunho não enviado) + chave estrangeira (sem versões) + ação do servidor + diálogo de confirmação + `material.deleted` |
| 5 | Projeto concluído não recebe material, no servidor | `saveMaterialAction` recusa; **o banco não reforça**. Pode virar trava de banco numa migration futura (hoje o banco só garante o vínculo cliente-projeto e cliente ativo) |
| 6 | Aviso, sem bloquear, quando a publicação é anterior ao prazo | aviso ao vivo no formulário (`publishBeforeApproval`); o servidor aceita |
| 7 | Diálogos responsivos, acessíveis e confortáveis para legenda longa | diálogo largo (`sm:max-w-2xl`) que rola por dentro (`max-h-[calc(100dvh-2rem)]`), campos controlados (um envio recusado **não apaga** o que foi digitado), contador de caracteres com `aria-live`, rótulos e erros ligados por `aria-describedby` |

## 12.2 O que foi entregue

- **Segurança da revisão (revisão de 2026-11-04):** o sinal `app.revision_in_progress` se mostrou forjável e foi **substituído por tíquete** vinculado a material, transação e usuário, emitido só por função interna; `UPDATE` direto de status de material aprovado também passou a exigir o tíquete (`MIGRACOES-B.md`, seção 6).
- **Migrations B1 e B2** (`supabase/migrations/20261104120000_…` e `…120100_…`; conteúdo, hashes e procedimento em `MIGRACOES-B.md`) e `verify.sql` com 25 blocos.
- **Grants revisados:** o app não altera diretamente `status`, `id`, `project_id`, `client_id`, `type`, `created_by`, `created_at` nem `updated_at` de `materials` (testes de catálogo, de banco e `verify.sql` bloco 25).
- **`/admin/materiais` (modo real):** lista com busca por título, filtros por cliente, projeto (em cascata), status e tipo, paginação de 20 em 20, e "Novo material" em diálogo. **`/admin/materiais/[id]`:** legenda (com quebras de linha), descrição, proporção, canal, datas, nota sobre arquivos (etapa C), "Editar" e "Excluir" (só rascunho sem versão). No modo demonstração as duas telas continuam com os dados fictícios da Fase 1.
- **Permissões:** `authorizeStaff()` sem exigir `manageClients`: **designer, atendimento e admin** cadastram, editam e excluem (espelha a RLS); aprovador e anônimo não. Nenhuma operação usa a chave secreta (`no-secret-key.test.ts` cobre `src/lib/materials` e `src/components/materials`).
- **Auditoria:** `material.created`, `material.updated`, `material.deleted`, sem título, legenda nem descrição (`AUDITORIA.md`).
- **Correção encontrada pelo E2E (também na etapa A):** depois de "Limpar", os campos dos filtros continuavam mostrando o filtro antigo (selects e busca não controlados ignoram a mudança de `defaultValue` na navegação). Os formulários de filtro de **materiais, clientes e projetos** agora são remontados quando os filtros da URL mudam; teste de componente nos dois.

## 12.3 Arquitetura para preservar o que o cliente vê (etapa D)

O que o cliente enxerga ao aprovar é uma lista fixa de campos (`PRESENTED_FIELDS` em `src/lib/materials/schema.ts`): título, descrição, legenda, tipo, proporção, canal, data de publicação e prazo. Desses, os **travados** pelo banco depois do envio são `LOCKED_CONTENT_FIELDS` (título, descrição, legenda, canal, proporção; o tipo já é imutável); as **datas** continuam editáveis (reagendar não muda a arte nem o texto).

Como a trava só cobre o material **vivo**, o que foi mostrado numa versão precisa ser guardado à parte. Proposta para a etapa D (a aprovar no plano dela):

1. Uma tabela imutável `material_version_contents` (uma linha por versão: `version_id`, `material_id`, `client_id`, `content jsonb` com os `PRESENTED_FIELDS`, `frozen_at`), com FK composta, RLS (equipe vê tudo; aprovador só de versão enviada), sem UPDATE nem DELETE.
2. A cópia é gravada **no envio** da versão para aprovação (gatilho/função do pedido de aprovação, que já valida arquivos e versão mais recente), e não na criação da versão: assim o rascunho continua editável até o envio e a cópia reflete exatamente o que o cliente recebeu.
3. O portal e o link seguro leem **a cópia** da versão, nunca o material vivo; o histórico mostra a cópia de cada versão.
4. Teste de banco "a lista de campos da cópia é a mesma de `PRESENTED_FIELDS`", como já existe para os campos travados.

## 12.4 Operação explícita de revisão (planejada, não implementada)

Problema hoje: `app.versions_before_insert()` voltava o material a rascunho em **qualquer** nova versão, inclusive de material aprovado. A B1 já fecha isso: material `aprovado` recusa nova versão e mudança de status sem um **tíquete** (`app.revision_tickets`, vinculado a material, transação e usuário; `MIGRACOES-B.md`, seção 6). O antigo sinal `app.revision_in_progress` foi removido por ser forjável. Falta a função que emite o tíquete (etapa D):

`public.start_material_revision(p_material_id uuid, p_reason text)` — `SECURITY DEFINER`, `search_path = ''`, `revoke … from public, anon`, só equipe com acesso ao cliente:

1. Aceita só material `aprovado` ou `alteracao` e **sem** solicitação aberta; para `aprovado`, exige o motivo (curto, validado) e a confirmação na tela (a decisão anterior continua valendo no histórico).
2. Chama `app.grant_revision_ticket(p_material_id)` **na própria transação** (única função autorizada a emitir tíquete), cria a próxima versão (**sem tocar** nas versões, arquivos, decisões nem cópias de conteúdo anteriores) e devolve o material a `rascunho`; o tíquete é consumido pelo gatilho de status (uso único).
3. Audita `material.revision_started` (`status_from`, `status_to`; **sem** o texto do motivo no metadata, só o tamanho ou um código; o motivo fica numa coluna imutável da versão).
4. Testes: material aprovado recusa nova versão por qualquer outro caminho; a função preserva versões, decisões e cópias; o tíquete não vale em outra transação, outro material ou outro usuário; designer e atendimento podem, aprovador não; `verify.sql` ganha o bloco da função (só `authenticated` e `service_role`).

## 12.5 Arquivos

**Criados (17):** `supabase/migrations/20261104120000_materials_content_and_guards.sql`, `supabase/migrations/20261104120100_audit_materials.sql`, `docs/MIGRACOES-B.md`; `src/lib/materials/{schema,selects,queries,schema.test,queries.test}.ts`; `src/app/admin/materiais/{actions.ts,actions.test.ts}`; `src/components/materials/{material-form-dialog,delete-material-button,material-filters,materials-list}.tsx` e `materials-ui.test.tsx`; `src/test/db/materials-b.test.ts`; `e2e/materiais.spec.ts`.

**Modificados (15):** `supabase/verify.sql` (27 blocos), `src/app/admin/materiais/page.tsx` e `[id]/page.tsx` (real + demonstração), `src/lib/clients/errors.ts` (entidade "material" e mensagens das travas), `src/lib/clients/schema.ts` (exporta `squash` e `isRealDate`), `src/components/auth/auth-layout.tsx` (tom "aviso" no `Notice`), `src/components/clients/list-filters.tsx` (remonta o formulário) e `clients-ui.test.tsx`, `src/test/db/privileges.test.ts`, `src/test/no-secret-key.test.ts`, `e2e/support/mock-supabase.mjs` (materiais), `playwright.config.ts` (projeto `materiais-real`), `docs/*` e `CLAUDE.md`.

## 12.6 Testes

| Verificação | Resultado |
|---|---|
| Lint e `tsc` | Limpos |
| Vitest (suíte inteira) | **636 aprovados em 37 arquivos** (antes: 511 em 32) |
| — banco (Postgres em memória, 10 migrations) | **250**; 46 novos em `materials-b.test.ts` (grants por coluna, cadastro por papel, FK composta, limites de legenda e proporção, cliente arquivado até para o servidor, trava de conteúdo por status e por campo, aprovado sem volta a rascunho, sinal de revisão restrito à transação, exclusão, auditoria sem texto livre, só o admin lê); +1 em `privileges.test`; +5 blocos do `verify.sql` (27) e 1 teste de detecção dos blocos do schema `app` |
| — validação, consultas, ações | 18 + 11 + 21 |
| — componentes | 21 novos (+1 em clientes) |
| Prova de que os testes não são vazios | sem a B2, 2 testes falham; sem B1 e B2, a maioria falha; 4 mutações do tíquete são detectadas; sem a remontagem dos filtros, os 2 testes de "Limpar" falham |
| Build de produção isolado | 19 rotas, sem avisos |
| E2E (Playwright, 4 servidores) | **95 de 95** (83 anteriores + 12 novos de materiais) |

Limites do que foi provado: o servidor falso do E2E **não prova a RLS** nem as constraints (isso é do teste de banco); as consultas com `select` embutido (`clients(...)`, `projects(...)`, `versions:material_versions(count)`) **ainda não foram executadas contra o PostgREST real** (as colunas novas só existem depois da B1) — validar logo após a aplicação.

## 12.7 Critérios de aceite da etapa B

| # | Critério | Resultado | Evidência |
|---|---|---|---|
| 1 | Admin, atendimento e designer cadastram e editam em cliente ativo; aprovador e anônimo não, no servidor e no banco | Atendido | `actions.test`, `materials-b.test`, E2E |
| 2 | Projeto pertence ao cliente (banco); projeto concluído recusado (servidor) | Atendido | FK composta, `actions.test` |
| 3 | Cliente arquivado não recebe material novo (banco, inclusive `service_role`) | Atendido | B1, `materials-b.test` |
| 4 | Conteúdo travado fora de rascunho; datas editáveis | Atendido | B1, banco, ação, componente e E2E |
| 5 | `status`, `type`, `project_id`, `client_id`, `created_by` não graváveis pelo app | Atendido | catálogo, `verify.sql` 25, banco |
| 6 | Só rascunho vazio é excluído | Atendido | RLS + FK + ação + E2E |
| 7 | Auditoria de criar, editar e excluir, sem texto livre | Atendido | B2, `materials-b.test` |
| 8 | Telas reais não leem `src/lib/mock`; demonstração intacta | Atendido | E2E (real e demo) |
| 9 | Nenhuma operação usa a chave secreta | Atendido | `no-secret-key.test` |
| 10 | Suíte inteira, build e E2E verdes | Atendido | 12.6 |
| 11 | Validação no banco real após autorização | **Pendente** | `MIGRACOES-B.md`, seção 3 |
| 12 | Material aprovado não volta a rascunho por nova versão simples | Atendido (regra) / operação de revisão **planejada** | B1, 12.4 |

## 12.8 Pendências e riscos

1. **Aplicar B1 e B2** no projeto de desenvolvimento (só com autorização expressa, uma por vez) e rodar o teste operacional com dados "TESTE B"; depois validar as consultas com `select` embutido contra o PostgREST real.
2. **Commit do endurecimento da B1** (tíquete de revisão) aguardando autorização.
3. A trava de conteúdo só pode ser vista no banco real quando um material sair de rascunho (Módulo 4); até lá, é provada pelos testes de banco.
4. Regra de projeto concluído só no servidor (12.1, item 5).
5. Sem arquivos: o material fica `rascunho` até as etapas C e D; o portal não mostra nada (a RLS só mostra material enviado).
6. Observação de baixa prioridade herdada da A.2: formulário que perde o texto depois de recusa. **Resolvido nos diálogos de material** (campos controlados); os diálogos de cliente, projeto e aprovador da etapa A seguem como estavam.
