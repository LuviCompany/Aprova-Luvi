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

## Estado atual: Fase 1 (protótipo com dados fictícios)

- Tudo vem de `src/lib/mock/data.ts`. **Não há backend, banco, auth, e-mail nem storage ainda.**
- Estado de interações (aprovar, comentar) vive só no navegador e some ao recarregar.
- Login aceita qualquer e-mail válido + senha de 6+ caracteres; o código da aprovação rápida é `123456`. Tudo isso é demonstração e **deve ser substituído na Fase 2**.
- Links de demonstração: `/aprovar/demo` (válido), `/aprovar/expirado`, `/aprovar/revogado`, `/aprovar/utilizado`.
- "Agora" é fixo em `NOW` (`2026-10-28T12:00:00-03:00`) para manter telas e testes determinísticos. Nunca usar `Date.now()` nas regras de domínio; receber a data por parâmetro.
- **Não implementar o backend completo antes de o usuário validar a Fase 1.**

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
npm test             # Vitest (unitários e de componente)
npm run test:e2e     # Playwright: faz build, sobe em :3100, roda desktop + celular
npm run check        # lint + typecheck + testes unitários (rodar antes de entregar)
```

## Estrutura

```
src/app/            rotas (login, admin, portal, aprovar/[token], not-found)
src/components/     componentes de produto (material-review, decision-panel, comments-panel…)
src/components/ui/  shadcn/ui — gerado pela CLI, editar com parcimônia
src/lib/domain.ts   regras de negócio puras (estado do link, KPIs, filtros) — onde ficam os testes
src/lib/types.ts    modelos de domínio
src/lib/mock/       dados fictícios da Fase 1
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

## Segurança (valem desde já e são obrigatórias na Fase 2)

1. **Autorização no servidor + RLS** no Postgres. Esconder botão na UI não é controle de acesso.
2. **Isolamento por cliente**: um aprovador nunca vê dados de outro cliente. Recurso de outro cliente responde igual a recurso inexistente (já demonstrado em `/portal/materiais/[id]`).
3. **Arquivos em storage privado**; acesso por URL assinada de curta duração. Nada de bucket público.
4. **Links de aprovação** revogáveis, com expiração e uso controlado. Guardar só o **hash** do token; token em URL nunca vai para log, analytics ou `Referer` (a página já usa `referrer: no-referrer` e `robots: noindex`). Token desconhecido e revogado exibem respostas equivalentes para não enumerar tokens.
5. **Identidade do aprovador** confirmada no fluxo por link (código por e-mail validado no servidor — na Fase 1 é só simulado).
6. **Decisões são imutáveis**: aprovar/pedir alteração gera registro novo (quem, quando, versão, canal); nunca editar nem apagar histórico. Nova versão não apaga a anterior.
7. **Nunca expor segredos no frontend.** Somente variáveis `NEXT_PUBLIC_*` podem ir ao navegador; `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY` e `APPROVAL_LINK_SECRET` ficam só no servidor. `.env*` está no `.gitignore` (exceto `.env.example`).
8. Validar toda entrada no servidor (ex.: Zod) e limitar tentativas (código de verificação, login).

## Regras de trabalho

- **Não fazer deploy nem alterar projetos em produção sem autorização expressa do usuário.** Não mexer no repositório/publicação do Site-Luvi.
- Não commitar nem dar push sem o usuário pedir.
- Se precisar de credenciais, permissões ou decisões externas (projeto Supabase, domínio de envio no Resend, DNS), pedir apenas o estritamente necessário e nunca registrar segredos em arquivos versionados.
- Antes de entregar qualquer mudança: `npm run check`; para mudanças de fluxo/UX, também `npm run test:e2e`.

## Roteiro

1. **Fase 1 (atual):** design system, layouts, dashboard, login, portal e aprovação rápida com dados fictícios.
2. **Fase 2:** Supabase (schema, migrations, RLS, Auth por papel), Storage privado, upload real, links de aprovação reais, versões e histórico persistidos.
3. **Fase 3:** e-mails via Resend (novo material, decisão tomada, lembrete de prazo), notificações, filtros/indicadores com dados reais.
4. **Fase 4:** endurecimento (rate limit, auditoria, backups), observabilidade e publicação em `aprova.luvicompany.com.br` — somente com autorização.
