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

1. **Banco de dados** — `supabase/migrations/` (4 arquivos): esquema, funções, RLS e storage. Testado com PGlite (`npm run test:db`) **e aplicado no projeto de desenvolvimento**, com `supabase/verify.sql` (16 blocos) todos em 0.
2. **Autenticação** — Supabase Auth (login, recuperação de senha, convite, logout), `src/proxy.ts`, DAL em `src/lib/auth/session.ts`. Primeiro administrador criado (`admin@luvicompany.com.br`) e login/rotas validados (testes manuais do usuário).

**Módulo 3 (Gestão de Materiais), em andamento por etapas — plano e acompanhamento em `docs/MODULO-3.md`:** a **etapa A (clientes e projetos) está concluída**: `/admin/clientes` e `/admin/projetos` leem e gravam no banco real (cadastro, edição, arquivamento, filtros). As etapas B a F (materiais, upload, carrosséis e versões, dashboard real, testes) **não foram iniciadas** e só começam com autorização expressa, uma por vez.

**Módulo 4** (solicitações, aprovação no portal, link seguro com código, comentários, decisões reais) **não iniciado**. Enquanto isso, o dashboard, os materiais, o histórico, os usuários e o portal **ainda leem `src/lib/mock/`**: essas telas mostram o aviso de dados de demonstração (`MockDataNotice`) fora do modo demonstração. Fora do modo demonstração, `/aprovar/[token]` responde sempre "link inválido".

**Pendências conhecidas (detalhes em `docs/CHECKLIST-LANCAMENTO.md`):** recuperação de senha por e-mail **ainda não testada** (precisa de SMTP próprio com o Resend: `docs/EMAIL-RESEND.md`); timeouts de conexão do ambiente de desenvolvimento são da **rede local** (`docs/DIAGNOSTICO-REDE.md`, `npm run net:check`); não existe projeto Supabase de produção; a `main` (demonstração publicada) tem o defeito do menu do usuário já corrigido na `fase-2`.

### Modo demonstração x modo real

- `APROVA_DEMO_MODE=true` liga o modo demonstração da Fase 1 (login fictício, dados de exemplo, links `/aprovar/demo|expirado|revogado|utilizado`, código `123456`).
- Ele só vale **se `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` estiverem ausentes**: configurar o Supabase desliga a demonstração (`isDemoMode()` em `src/lib/env.ts`). O login fictício nunca convive com usuários reais.
- Sem Supabase e sem demo, tudo falha fechado (login mostra "ambiente não configurado").
- **Produção atual** (`aprova.luvicompany.com.br`) roda a Fase 1 em modo demonstração. Fazer deploy desta branch **sem** configurar o Supabase e **sem** `APROVA_DEMO_MODE=true` derruba a demonstração. Nada disso foi publicado.
- "Agora" nos dados fictícios é fixo em `NOW` (`2026-10-28T12:00:00-03:00`). Nunca usar `Date.now()` nas regras de domínio; receber a data por parâmetro.
- Configuração do Supabase: `docs/SUPABASE.md`.
- **Projeto Supabase de desenvolvimento/validação: "DB Aprova Luvi"** (`kswnwootbdzlhdvbhhpk`), só com `http://localhost:3000`, sem dados de clientes reais e **fora da produção**. As 4 migrations **já foram aplicadas nele** (2026-11-02). Para QUALQUER outro projeto, antes de aplicar: confirmar que o banco está vazio (`supabase/preflight.sql`) e que nenhum app o usa (o projeto Vercel `system` usa outro Supabase: conferir que não é este). A migration 3 revoga privilégios em todo o schema `public`, então jamais aplicá-la num projeto compartilhado. No SQL Editor, o aviso "creates tables without enabling RLS" da migration 1 é esperado: escolher "Run without RLS" (a RLS vem na migration 3).
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
npm run test:e2e     # build + Playwright: demo em :3100 (desktop+celular), modo real em :3101 e modo real com servidor FALSO de Auth/PostgREST em :3102 (e2e/support/mock-supabase.mjs)
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
src/components/clients/  formulários em janela, cartões e filtros de clientes/projetos
src/lib/supabase/   server.ts (usuário, RLS), admin.ts (service_role, só servidor), proxy.ts (renovação de sessão)
src/proxy.ts        primeira barreira: anônimo em /admin, /portal, /redefinir-senha vai ao /login
src/test/db/        harness PGlite + testes de esquema, RLS, isolamento e aprovação
supabase/           migrations SQL, preflight.sql (banco vazio?), verify.sql (auditoria pós-migration), config.toml e modelos de e-mail
scripts/            bootstrap-admin.mjs (primeiro administrador, roda uma vez; já usado no dev), check-env.mjs, check-network.mjs
docs/SUPABASE.md    passo a passo de configuração e variáveis
docs/VALIDACAO-FASE-2.md     registro da validação (testes manuais do usuário x automatizados)
docs/DIAGNOSTICO-REDE.md     timeouts de conexão: evidências, causa (rede local) e o que fazer
docs/EMAIL-RESEND.md         recuperação de senha e SMTP com o Resend: o que falta
docs/CHECKLIST-LANCAMENTO.md checklist de segurança e lançamento
docs/MODULO-3.md            plano por etapas (A–F), critérios de aceite, lacunas de banco e teste manual do Módulo 3
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

- **Migrations são imutáveis depois de aplicadas** em qualquer projeto Supabase: mudança = nova migration. **As quatro atuais já estão aplicadas no projeto de desenvolvimento (2026-11-02): não edite os arquivos, crie uma migration nova** (e rode `verify.sql` depois). Toda alteração em `supabase/migrations/` exige `npm run test:db` verde, com teste novo para a regra alterada.
- **Função nova = `revoke execute on function … from public, anon;` na própria migration** (o Postgres abre EXECUTE a PUBLIC por padrão e isso não dá para desligar globalmente). `privileges.test.ts` audita o catálogo e reprova qualquer função/tabela/política fora da lista permitida; `supabase/verify.sql` é a mesma auditoria para rodar no projeto real.
- Modelo: `organizations` → `profiles` (1:1 com `auth.users`, papel `admin|designer|atendimento|cliente`) → `clients` → `approvers` (vínculo opcional a um perfil de login) → `projects` → `materials` → `material_versions` (imutáveis) → `material_files` (um por slide) → `approval_requests` → `approval_links` (só o **hash** do token) → `comments` / `decisions` (imutáveis) / `audit_events`.
- Todas as tabelas de negócio carregam `client_id`; FKs compostas impedem filho apontando para pai de outro cliente. Nada tem `ON DELETE CASCADE`: arquivar é `active = false`.
- RLS ligada em tudo; `anon` não tem acesso a tabela nenhuma; `authenticated` recebe grants mínimos por coluna (ex.: o status do material e o `token_hash` não são graváveis/legíveis pelo app). Segredos (`approval_verifications`, `approval_link_sessions`) só o `service_role` acessa.
- **Telas reais do painel (Módulo 3):** leitura em `src/lib/clients/queries.ts` e escrita em Server Actions com `authorizeStaff()` (`src/lib/auth/action-guard.ts`), sempre com o cliente Supabase **do usuário** (RLS). **Nunca importar `src/lib/supabase/admin` nessas áreas** (`src/test/no-secret-key.test.ts` reprova). Tela que passa a ler o banco **deixa de renderizar `<MockDataNotice />`** e nunca importa `src/lib/mock` fora do modo demonstração; `organization_id` e `created_by` vêm da sessão do servidor, nunca do formulário.
- Mudanças de estado de aprovação só por funções SQL (`decide_as_approver`, `decide_via_link`, `create_approval_link`, `revoke_approval_link`, `cancel_approval_request`); `decide_via_link` é só do servidor.
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
