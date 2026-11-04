# CLAUDE.md — Aprova Luvi

Convenções e contexto para qualquer sessão (Claude ou humano) que mexer neste projeto.

@AGENTS.md

## O que é

**Aprova Luvi** é a plataforma de aprovação de materiais criativos da agência **Luvi Company**. É uma aplicação **independente** do site institucional (`LuviCompany/Site-Luvi`): nunca alterar aquele repositório nem a publicação dele. Domínio futuro: `aprova.luvicompany.com.br` (sem deploy sem autorização explícita).

Nome oficial na interface: **Aprova Luvi** — sempre assim, sem variações (nada de "AprovaLuvi" ou caixa diferente).

Três ambientes:

| Ambiente | Rota | Quem usa |
|---|---|---|
| Painel administrativo | `/admin/*` | Equipe Luvi |
| Portal do cliente | `/portal/*` | Aprovadores autenticados |
| Aprovação rápida | `/aprovar/[token]` | Aprovador com link seguro (sem login) |

## Estado atual: Fase 2 em andamento (branch `fase-2`)

**Módulos prontos e VALIDADOS no projeto de desenvolvimento "DB Aprova Luvi" (2026-11-02; registro em `docs/VALIDACAO-FASE-2.md`):**

1. **Banco de dados** — `supabase/migrations/` (12 arquivos: 4 da Fase 2, 4 da etapa A.2, 2 da etapa B e 2 das etapas C/D — todas as doze aplicadas no projeto de desenvolvimento): esquema, funções, RLS, storage, integridade, aprovadores em vários clientes, convites preparados e auditoria. Testado com PGlite (`npm run test:db`) **e aplicado no projeto de desenvolvimento**, com `supabase/verify.sql` (16 blocos) todos em 0.
2. **Autenticação** — Supabase Auth (login, recuperação de senha, convite, logout), `src/proxy.ts`, DAL em `src/lib/auth/session.ts`. Primeiro administrador criado (`admin@luvicompany.com.br`) e login/rotas validados (testes manuais do usuário).

**Módulo 3 (Gestão de Materiais), em andamento por etapas — plano e acompanhamento em `docs/MODULO-3.md`:** a **etapa A (clientes e projetos) está concluída**: `/admin/clientes` e `/admin/projetos` leem e gravam no banco real (cadastro, edição, arquivamento, filtros). As etapas B a F (materiais, upload, carrosséis e versões, dashboard real, testes) estão **concluídas e validadas no banco de desenvolvimento** (abaixo e `docs/MODULO-3.md`, seções 13 e 14).

**Etapa A.2 (aprovadores) implementada e com as migrations `20261103120000` a `20261103120300` APLICADAS no projeto de desenvolvimento em 2026-11-03** (uma por vez, com `verify.sql` de 22 blocos em 0; registro em `docs/MIGRACOES-A2.md`, seção 6; auditoria e retenção em `docs/AUDITORIA.md`). **Validação operacional com dados fictícios aprovada em 2026-11-03** (11 de 11 testes, `docs/MODULO-3.md`, seção 11; os dados de teste "TESTE A2" e os 11 eventos de auditoria permanecem no projeto de desenvolvimento e não devem ser apagados sem autorização). O portal exige **escolha explícita de empresa** quando o aprovador tem mais de um vínculo ativo (nunca "o primeiro").

**Módulo 3 FINALIZADO LOCALMENTE em 2026-11-05 (etapas B a F; `docs/MODULO-3.md`, seção 13):** upload privado (URL assinada de uso único, envio direto do navegador ao bucket `materials`, conferência de tamanho e assinatura no servidor, limpeza em falha), carrosséis de 1 a 10 slides com ordenação, histórico imutável de versões, conteúdo congelado por versão (`material_version_contents`), operação explícita de revisão (`start_material_revision`, com tíquete), visualização protegida (`/admin/arquivos/[fileId]`, URL assinada de 60 s) e dashboard com dados reais. **Migrations B1, B2, C1 e C2 APLICADAS no projeto de desenvolvimento em 2026-11-05** (uma por vez, SHA-256 completo conferido; `docs/MIGRACOES-C.md`, seção 7; `verify.sql` 28/28 em 0) e **validação operacional com dados fictícios "TESTE C" aprovada** (`docs/MODULO-3.md`, seção 14; os dados de teste e os eventos de auditoria permanecem e não devem ser apagados sem autorização). Testes: Vitest 734, E2E 110.

**Etapa B (cadastro de materiais) implementada em 2026-11-04 (commits `13ce79a` e `c9a81f2`) e com as migrations `20261104120000` e `20261104120100` (B1 e B2) APLICADAS em 2026-11-05** (`docs/MODULO-3.md`, seção 12; `docs/MIGRACOES-B.md`): `/admin/materiais` (lista, filtros, paginação, diálogo de cadastro e edição, exclusão de rascunho vazio) e `/admin/materiais/[id]` leem e gravam no banco real; no modo demonstração seguem fictícias. Conteúdo do material (título, descrição, legenda, canal, proporção) é travado no banco fora de rascunho; material aprovado só muda de estado pela operação explícita de revisão (`start_material_revision`, etapa D), que exige um **tíquete** (`app.revision_tickets`, vinculado a material, transação e usuário, emitido só por `app.grant_revision_ticket`, sem `EXECUTE` para a API); o antigo sinal `app.revision_in_progress` foi removido por ser forjável.

**Módulo 4 (Motor de Aprovação) IMPLEMENTADO LOCALMENTE em 2026-11-04** (`docs/MODULO-4.md`; migrations `docs/MIGRACOES-D.md`): envio com vários aprovadores (solicitação individual por aprovador, política "todos aprovam; qualquer alteração leva a ajustes"), portal autenticado real (dashboard por situação, revisão com slides e conteúdo congelado, comentários, decisão, histórico, arquivos por rota protegida), aprovação por link sem login com código de 6 dígitos (HMAC), sessão curta, limites e revogação, reenvio após revisão e acompanhamento no dashboard. **As migrations D1 (`20261106120000`) e D2 (`20261106120100`) foram APLICADAS no projeto de desenvolvimento em 2026-11-04** (uma por vez, SHA-256 conferido; `verify.sql` 30/30 em 0; registro em `docs/MIGRACOES-D.md`, seção 6); falta a validação operacional com dados fictícios. Testes: Vitest 836, E2E 121. O que ainda lê `src/lib/mock/` fora da demonstração: só a tela de usuários (`MockDataNotice`). Sem SMTP/Resend configurado o código do link não é enviado (provedor `simulated` só fora de produção).

**Pendências conhecidas (detalhes em `docs/CHECKLIST-LANCAMENTO.md`):** recuperação de senha por e-mail **ainda não testada** (precisa de SMTP próprio com o Resend: `docs/EMAIL-RESEND.md`); timeouts de conexão do ambiente de desenvolvimento são da **rede local** (`docs/DIAGNOSTICO-REDE.md`, `npm run net:check`); não existe projeto Supabase de produção; a `main` (demonstração publicada) tem o defeito do menu do usuário já corrigido na `fase-2`.

### Modo demonstração x modo real

- `APROVA_DEMO_MODE=true` liga o modo demonstração da Fase 1 (login fictício, dados de exemplo, links `/aprovar/demo|expirado|revogado|utilizado`, código `123456`).
- Ele só vale **se `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` estiverem ausentes**: configurar o Supabase desliga a demonstração (`isDemoMode()` em `src/lib/env.ts`). O login fictício nunca convive com usuários reais.
- Sem Supabase e sem demo, tudo falha fechado (login mostra "ambiente não configurado").
- **Produção atual** (`aprova.luvicompany.com.br`) roda a Fase 1 em modo demonstração. Fazer deploy desta branch **sem** configurar o Supabase e **sem** `APROVA_DEMO_MODE=true` derruba a demonstração. Nada disso foi publicado.
- "Agora" nos dados fictícios é fixo em `NOW` (`2026-10-28T12:00:00-03:00`). Nunca usar `Date.now()` nas regras de domínio; receber a data por parâmetro.
- Configuração do Supabase: `docs/SUPABASE.md`.
- **Projeto Supabase de desenvolvimento/validação: "DB Aprova Luvi"** (`kswnwootbdzlhdvbhhpk`), só com `http://localhost:3000`, sem dados de clientes reais e **fora da produção**. As 12 migrations (4 da Fase 2, em 2026-11-02; 4 da A.2, em 2026-11-03; e B1, B2, C1 e C2, em 2026-11-05) **já foram aplicadas nele**. Para QUALQUER outro projeto, antes de aplicar: confirmar que o banco está vazio (`supabase/preflight.sql`) e que nenhum app o usa (o projeto Vercel `system` usa outro Supabase: conferir que não é este). A migration 3 revoga privilégios em todo o schema `public`, então jamais aplicá-la num projeto compartilhado. No SQL Editor, o aviso "creates tables without enabling RLS" da migration 1 é esperado: escolher "Run without RLS" (a RLS vem na migration 3).
- **Operação com segredos:** links de convite/recuperação valem como senha. Comandos que os imprimem (`bootstrap-admin --execute`) rodam no **painel de Terminal do usuário**, e a saída desse terminal não é lida pelo assistente. Nunca exibir chaves em chat/terminal compartilhado; o `.env.local` é preenchido só pelo usuário. As chaves do dev apareceram no registro de uma sessão (leitura do `.env.local`): girar quando conveniente.
- **Pedidos sensíveis exigem autorização expressa e por escrito do usuário:** commit (só na `fase-2`), qualquer escrita em projeto remoto, bootstrap, e-mails. Nunca push, merge ou deploy sem pedido explícito; nunca alterar a `main` nem a produção.

## Stack

Next.js 16 (App Router, `cacheComponents` + `partialPrefetching` ligados) · React 19 · TypeScript estrito · Tailwind CSS 4 · shadcn/ui (estilo `base-nova`, primitivos `@base-ui/react`) · Vitest + Testing Library · Playwright. Planejado para a Fase 2: Supabase (Postgres, Auth, Storage) e Resend.

Este Next.js **não é o que você conhece**. Antes de escrever código de roteamento/cache, ler o guia relevante em `node_modules/next/dist/docs/` (ver `AGENTS.md`). Pontos já confirmados:

- `params` é `Promise`; usar os helpers globais `PageProps<"/rota/[id]">` / `LayoutProps<"/">`.
- Com `cacheComponents`, `usePathname()` e `await params` precisam estar sob `<Suspense>`. Rotas dinâmicas têm `loading.tsx`; navegação ativa fica em componente isolado dentro de `<Suspense>`.
- Com streaming o status HTTP já saiu como 200 quando `notFound()` roda dentro do Suspense: testar a página "não encontrada" pelo conteúdo, não pelo status.
- Rodar `npm run typecheck` (faz `next typegen` antes) — sem isso os tipos de rota não existem.
- Componentes base-ui usam a prop `render={<Link … />}` em vez de `asChild`.

## Comandos

```bash
npm run dev          # servidor local (porta 3000)
npm run lint         # ESLint
npm run typecheck    # next typegen + tsc --noEmit
npm test             # Vitest: unitários, componentes e banco (PGlite)
npm run test:db      # só os testes de banco/RLS (src/test/db)
npm run test:e2e     # build + Playwright: demo em :3100 (desktop+celular), modo real em :3101, modo real com servidor FALSO de Auth/PostgREST em :3102 (e2e/support/mock-supabase.mjs) e :3103 (mesmo mock + chave secreta, segredo do link e e-mail simulado: aprovacao.spec.ts)
npm run check        # lint + typecheck + testes (rodar antes de entregar)
npm run env:check    # confere variáveis de ambiente sem abrir conexão nem imprimir chaves
npm run net:check    # diagnostica timeouts: conexões TCP ao Supabase vs. destinos de controle (sem chaves)
```

Se `next build` falhar com `EPERM ... .next` (OneDrive travando arquivos), apague `.next` e rode de novo.

**Build/E2E com o `npm run dev` ligado:** o `next dev` guarda o estado em `.next/dev`, então não rode `next build` por cima dele. Use um diretório separado (o `next.config.ts` lê `NEXT_DIST_DIR`), em Bash:

```bash
NEXT_DIST_DIR=.next-e2e npx next build && NEXT_DIST_DIR=.next-e2e npx playwright test
```

O build reescreve o `include` do `tsconfig.json` para o novo diretório: desfaça com `git checkout -- tsconfig.json` e apague `.next-e2e` (ignorado pelo Git). Rode o E2E sem nada competindo pela CPU: com a máquina ocupada, um teste do portal já estourou o limite de 5 s.

## Estrutura

```
src/app/            rotas (login, admin, portal, aprovar/[token], not-found)
src/components/     componentes de produto (material-review, decision-panel, comments-panel…)
src/components/ui/  shadcn/ui — gerado pela CLI, editar com parcimônia
src/lib/domain.ts   regras de negócio puras (estado do link, KPIs, filtros) — onde ficam os testes
src/lib/types.ts    modelos de domínio
src/lib/mock/       dados fictícios (modo demonstração; serão substituídos nos Módulos 3 e 4)
src/lib/env.ts      leitura central de variáveis, isDemoMode()
src/lib/auth/       roles, safeNextPath, senha, erros (puros), session.ts (DAL: requireStaff/requireClientUser) e action-guard.ts (autorização das Server Actions)
src/lib/clients/    clientes e projetos (Módulo 3): schema/validação, consultas sob RLS, adaptador da demonstração
src/lib/approvers/  aprovadores (A.2): validação, agrupamento por pessoa, detalhe do cliente
src/lib/auth/portal-selection.ts  regra pura da escolha de empresa no portal (pickPortalContext)
src/components/clients/  formulários em janela, cartões e filtros de clientes/projetos
src/lib/materials/  materiais (etapa B): validação, consultas sob RLS, campos travados e apresentados ao cliente
src/components/materials/  diálogo de cadastro/edição, filtros, lista, exclusão de rascunho, upload, slides, histórico de versões e revisão
src/lib/dashboard/  métricas puras (data por parâmetro) e consultas do dashboard real
src/app/admin/arquivos/[fileId]/route.ts  visualização protegida de arquivos (redireciona para URL assinada de 60 s)
src/lib/approval/   motor de aprovação (usuário, RLS): schema, token, revisão (conteúdo congelado), consultas do portal e da equipe
src/lib/link-approval/  fluxo do link sem login (ÚNICO uso da chave secreta): service, HMAC, cookie de sessão, limites
src/lib/email/      provedor de e-mail (resend | simulated, recusado em produção)
src/components/approval/  revisão (slides, decisão, histórico), diálogo de envio, painel de acompanhamento, verificação do link
src/lib/supabase/   server.ts (usuário, RLS), admin.ts (service_role, só servidor), proxy.ts (renovação de sessão)
src/proxy.ts        primeira barreira: anônimo em /admin, /portal, /redefinir-senha vai ao /login
src/test/db/        harness PGlite + testes de esquema, RLS, isolamento e aprovação
supabase/           migrations SQL, preflight.sql (banco vazio?), verify.sql (auditoria pós-migration), config.toml e modelos de e-mail
scripts/            safe-commit.sh (commit com varredura de segredos; só `.env.example` entre os `.env*`), bootstrap-admin.mjs (primeiro administrador, roda uma vez; já usado no dev), check-env.mjs, check-network.mjs
docs/SUPABASE.md    passo a passo de configuração e variáveis
docs/VALIDACAO-FASE-2.md     registro da validação (testes manuais do usuário x automatizados)
docs/DIAGNOSTICO-REDE.md     timeouts de conexão: evidências, causa (rede local) e o que fazer
docs/EMAIL-RESEND.md         recuperação de senha e SMTP com o Resend: o que falta
docs/CHECKLIST-LANCAMENTO.md checklist de segurança e lançamento
docs/MODULO-3.md            plano por etapas (A–F), critérios de aceite, resultado da A.2 e teste manual do Módulo 3
docs/MIGRACOES-A2.md        migrations da A.2: conteúdo, hashes, riscos, procedimento seguro e rollback
docs/MIGRACOES-B.md         migrations da etapa B (materiais): conteúdo, hashes, procedimento seguro e reversão
docs/MIGRACOES-C.md         migrations das etapas C/D (arquivos, versões, revisão): conteúdo, hashes, procedimento e reversão
docs/MODULO-4.md            motor de aprovação: fluxo, política, link com código, e-mail, testes e validação pendente
docs/MIGRACOES-D.md         migrations D1/D2 (NÃO aplicadas): conteúdo, hashes, procedimento e reversão
docs/AUDITORIA.md           o que a auditoria grava (sem dados pessoais) e a política de retenção proposta
e2e/                testes Playwright
public/brand/       logo e favicon copiados do site institucional
```

## Design System Luvi

Origem: `Site-Luvi` (`CLAUDE.md` e `assets/css`). Tema **único e escuro**, tokens em `src/app/globals.css`.

| Token | Valor | Uso |
|---|---|---|
| `primary` | `#FF3B00` | CTAs, foco, item ativo, destaque |
| `primary-dark` | `#CC2F00` | hover do primário |
| `ink` / `background` | `#0A0A0A` | fundo |
| `surface` / `surface-2` | `#1A1A1A` / `#2A2A2A` | grafite: superfícies e botões secundários |
| `card` | `#141414` | cartões |
| `muted-foreground` | `#9CA3AF` | texto secundário |
| `success` / `warning` / `info` | `#34D399` / `#FBBF24` / `#60A5FA` | só para status |

- Fontes: **Montserrat** nos títulos (`font-heading`, aplicado em `h1–h4`), **Inter** no corpo. Playfair do site é só do hero dele — não usar aqui.
- Botões são **pílula** (`rounded-full`), como no site; cartões usam raio 0.75rem+. Sempre usar tokens (`bg-primary`, `text-muted-foreground`…), nunca hex solto em componente.
- Texto branco sobre `#FF3B00` tem contraste ~3,4:1: usar apenas em texto **semibold/grande** (botões já são `font-semibold`). Para texto pequeno sobre laranja, preferir `text-white font-semibold` em tamanho ≥ 14px ou trocar o fundo.
- Efeito de brilho lateral laranja: classe `.luvi-glow` (mesmo recurso do site). Efeito hover só com `@media (hover: hover)` — lição do site (hover "gruda" em touch).
- Status de material: `StatusBadge`/`TypeBadge` em `components/status-badge.tsx` são a única fonte de cor/ícone/rótulo por status. Rótulos em `lib/domain.ts` (`STATUS_LABEL`).
- Ícones: `lucide-react`. Gráficos: CSS puro (sem lib) até haver necessidade real.

## Convenções de código

- Todo texto de interface em **português do Brasil**, com acentuação correta. Identificadores de código em inglês **ou** em português do domínio (`aguardando`, `alteracao`) — manter o padrão do arquivo; valores de status do domínio são em português e estão em `lib/types.ts`.
- Server Components por padrão; `"use client"` só onde há estado/efeito/evento. Regra de negócio vai em `lib/domain.ts` como função pura e **ganha teste**.
- Acessibilidade é requisito: `label` em todo campo, `aria-live` em contagens que mudam, foco visível, `skip-link`, `prefers-reduced-motion` respeitado, navegação por teclado nos diálogos (base-ui já cuida do foco).
- Responsivo mobile-first; nenhuma tela pode gerar scroll horizontal (há teste E2E para isso). Tabelas rolam dentro do próprio contêiner.
- Não instalar o pacote npm `cn`: o registro do shadcn o referencia, mas o helper `cn` deste projeto é o padrão `clsx` + `tailwind-merge` em `src/lib/utils.ts`. Depois de rodar `npx shadcn add`, conferir se os imports não voltaram a apontar para `"cn"` (trocar por `@/lib/utils`) e se nenhum componente puxou `next-themes` (o `Toaster` é fixo em tema escuro).

## Banco de dados e autenticação (Fase 2)

- **Migrations são imutáveis depois de aplicadas** em qualquer projeto Supabase: mudança = nova migration. **As oito primeiras já estão aplicadas no projeto de desenvolvimento (2026-11-02 e 2026-11-03): não edite os arquivos, crie uma migration nova** (as quatorze estão aplicadas no projeto de desenvolvimento, com `verify.sql` de 28 blocos; **D1 e D2 do Módulo 4 também foram aplicadas no dev em 2026-11-04** e elevam o `verify.sql` para 30 blocos) (e rode `verify.sql` depois). Toda alteração em `supabase/migrations/` exige `npm run test:db` verde, com teste novo para a regra alterada.
- **Função nova = `revoke execute on function … from public, anon;` na própria migration** (o Postgres abre EXECUTE a PUBLIC por padrão e isso não dá para desligar globalmente). `privileges.test.ts` audita o catálogo e reprova qualquer função/tabela/política fora da lista permitida; `supabase/verify.sql` é a mesma auditoria para rodar no projeto real.
- Modelo: `organizations` → `profiles` (1:1 com `auth.users`, papel `admin|designer|atendimento|cliente`) → `clients` → `approvers` (vínculo opcional a um perfil de login) → `projects` → `materials` → `material_versions` (imutáveis) → `material_files` (um por slide) → `approval_requests` → `approval_links` (só o **hash** do token) → `comments` / `decisions` (imutáveis) / `audit_events`.
- Todas as tabelas de negócio carregam `client_id`; FKs compostas impedem filho apontando para pai de outro cliente. Nada tem `ON DELETE CASCADE`: arquivar é `active = false`.
- RLS ligada em tudo; `anon` não tem acesso a tabela nenhuma; `authenticated` recebe grants mínimos por coluna (ex.: o status do material e o `token_hash` não são graváveis/legíveis pelo app). Segredos (`approval_verifications`, `approval_link_sessions`) só o `service_role` acessa.
- **Telas reais do painel (Módulo 3):** leitura em `src/lib/clients/queries.ts` e escrita em Server Actions com `authorizeStaff()` (`src/lib/auth/action-guard.ts`), sempre com o cliente Supabase **do usuário** (RLS). **Nunca importar `src/lib/supabase/admin` nessas áreas** (`src/test/no-secret-key.test.ts` reprova). Tela que passa a ler o banco **deixa de renderizar `<MockDataNotice />`** e nunca importa `src/lib/mock` fora do modo demonstração; `organization_id` e `created_by` vêm da sessão do servidor, nunca do formulário.
- Mudanças de estado de aprovação só por funções SQL (D1/D2): `submit_for_approval` (o `INSERT` direto em `approval_requests` foi revogado), `decide_as_approver`, `create_approval_link`, `revoke_approval_link`, `cancel_approval_request` (cancela a rodada) e, **só para o servidor**, `link_resolve`, `link_issue_code`, `link_verify_code`, `link_session_context` e `decide_with_link_session` (a antiga `decide_via_link` foi removida). `app.record_decision` é o único que grava decisão (trava material → solicitação).
- **Chave secreta só no fluxo por link:** `src/lib/link-approval/` é o ÚNICO código do app que importa `supabase/admin`; páginas e ações de `/aprovar` passam por ele (`no-secret-key.test.ts` reprova o resto). Token, código e sessão nunca vão para log; o banco guarda só SHA-256 (token) e HMAC (código, sessão, IP).
- Triggers `BEFORE` rodam antes da RLS: qualquer um que leia dados de outro cliente deve checar `app.staff_can_access` primeiro (já foi um vazamento real, coberto em `rls.test.ts`).
- **Não há cadastro livre.** Perfis são criados só pelo servidor (service_role) após convite; o signup do Supabase Auth fica desligado.
- Autorização em duas camadas: `proxy.ts` (barra anônimos) e a DAL (`requireStaff`/`requireClientUser`/`requireAdmin`), sempre dentro de `<Suspense>` e com `await connection()` para ser decidida por requisição. Server Actions e Route Handlers chamam a DAL; nunca confiam só no proxy.
- Redirecionamentos pós-login passam por `safeNextPath`. Mensagens de login/recuperação são idênticas exista a conta ou não.
- Usar `createSupabaseAdminClient` (ignora RLS) só em código de servidor, depois de autorizar a operação no próprio código.
- **Chaves modernas**: `SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`) e `SUPABASE_SECRET_KEY` (`sb_secret_…`); os nomes legados (`ANON`/`SERVICE_ROLE`) só como reserva. `classifyKey` identifica o tipo pelo conteúdo e o app recusa chave secreta na variável pública.
- **E-mails de auth por ambiente**: o app envia `redirectTo = APP_URL/auth/recovery` (e `/auth/invite` no convite); `src/lib/auth/confirm.ts` trata os dois formatos de link (`?code=` do modelo padrão e `token_hash` do modelo do projeto), então **o app não depende de os modelos de e-mail terem sido editados** (o Supabase só libera a edição com SMTP próprio). Os modelos do projeto usam `{{ .RedirectTo }}` (não `{{ .SiteURL }}`). Lista de Redirect URLs de dev: `http://localhost:3000/auth/*`. Em desenvolvimento só `localhost` é aceito; em produção `APP_URL` precisa ser https. Dev e produção usam **projetos Supabase diferentes** (`docs/SUPABASE.md`).
- `scripts/bootstrap-admin.mjs` é simulação por padrão; `--execute` exige `--project-host`, recusa chave pública e `APP_URL` de produção, e **imprime o link de convite em vez de enviar e-mail** (`--send-email` envia, exige SMTP).

## Segurança (valem desde já e são obrigatórias na Fase 2)

1. **Autorização no servidor + RLS** no Postgres. Esconder botão na UI não é controle de acesso.
2. **Isolamento por cliente**: um aprovador nunca vê dados de outro cliente. Recurso de outro cliente responde igual a recurso inexistente (já demonstrado em `/portal/materiais/[id]`).
3. **Arquivos em storage privado**; acesso por URL assinada de curta duração. Nada de bucket público.
4. **Links de aprovação** revogáveis, com expiração e uso controlado. Guardar só o **hash** do token; token em URL nunca vai para log, analytics ou `Referer` (a página já usa `referrer: no-referrer` e `robots: noindex`). Token desconhecido e revogado exibem respostas equivalentes para não enumerar tokens.
5. **Identidade do aprovador** confirmada no fluxo por link (código por e-mail validado no servidor — na Fase 1 é só simulado).
6. **Decisões são imutáveis**: aprovar/pedir alteração gera registro novo (quem, quando, versão, canal); nunca editar nem apagar histórico. Nova versão não apaga a anterior.
7. **Nunca expor segredos no frontend.** Somente variáveis `NEXT_PUBLIC_*` podem ir ao navegador (hoje nenhuma é usada); `SUPABASE_SECRET_KEY` (`sb_secret_…`), `RESEND_API_KEY` e qualquer segredo de link ficam só no servidor. `.env*` está no `.gitignore` (exceto `.env.example`).
8. Validar toda entrada no servidor (ex.: Zod) e limitar tentativas (código de verificação, login).

## Regras de trabalho

- **Não fazer deploy nem alterar projetos em produção sem autorização expressa do usuário.** Não mexer no repositório/publicação do Site-Luvi.
- Não commitar nem dar push sem o usuário pedir.
- Se precisar de credenciais, permissões ou decisões externas (projeto Supabase, domínio de envio no Resend, DNS), pedir apenas o estritamente necessário e nunca registrar segredos em arquivos versionados.
- Antes de entregar qualquer mudança: `npm run check`; para mudanças de fluxo/UX, também `npm run test:e2e`.

## Roteiro

1. **Fase 1 (concluída, publicada em modo demonstração):** design system, layouts, dashboard, login, portal e aprovação rápida com dados fictícios.
2. **Fase 2 (em andamento, branch `fase-2`):** Módulos 1 (banco) e 2 (autenticação) **concluídos e validados no projeto de desenvolvimento**; faltam o Módulo 3 (Storage privado, upload real, versões) e o Módulo 4 (links de aprovação reais, decisões, histórico persistidos).
3. **Fase 3:** e-mails via Resend (novo material, decisão tomada, lembrete de prazo), notificações, filtros/indicadores com dados reais.
4. **Fase 4:** endurecimento (rate limit, auditoria, backups), observabilidade e publicação em `aprova.luvicompany.com.br` — somente com autorização.
