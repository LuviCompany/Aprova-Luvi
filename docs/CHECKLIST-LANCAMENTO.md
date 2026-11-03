# Checklist de segurança e lançamento — Aprova Luvi

Estado em **2026-11-02**, ao fim da validação da Fase 2 (Módulos 1 e 2). Legenda: `[x]` feito e evidenciado, `[ ]` pendente, `[~]` parcial. Quem: **Você** (painéis, DNS, decisões), **Eu** (código/testes, se autorizado).

> Regra de ouro: **nada vai para produção sem autorização expressa**. A produção atual é a demonstração da Fase 1 (branch `main`, `aprova.luvicompany.com.br`).

## A. Segurança — já garantido

- [x] RLS ligada em 15 de 15 tabelas; `anon` sem nenhum privilégio de tabela ou coluna (`supabase/verify.sql`, 16 blocos com 0 linhas, no projeto real).
- [x] Tabelas de segredos (`approval_verifications`, `approval_link_sessions`) sem política nem grant: só `service_role`.
- [x] Decisões, versões, comentários e auditoria imutáveis (triggers e grants); status do material só muda por função do banco.
- [x] Isolamento por cliente: chaves estrangeiras compostas + RLS + testes de vazamento entre clientes (`src/test/db/rls.test.ts`).
- [x] Funções `SECURITY DEFINER` com `search_path` vazio; nenhuma executável por `anon`; `decide_via_link` só para `service_role`.
- [x] Bucket `materials` privado, com limite de tamanho e lista de tipos MIME; sem política de UPDATE.
- [x] Sem cadastro livre: `disable_signup: true` (confirmado pela API); perfis só criados pelo servidor após convite.
- [x] Chave `sb_secret_` só no servidor; o app recusa chave secreta na variável pública; `.env*` fora do Git (varredura de segredos antes de cada commit).
- [x] Autorização em duas camadas (`proxy.ts` + DAL com `connection()`); anônimo em `/admin`, `/portal`, `/redefinir-senha` vai ao login; sem vazamento de conteúdo no redirecionamento.
- [x] Redirecionamento pós-login protegido contra open redirect (`safeNextPath`); mensagens de login/recuperação iguais exista ou não a conta.
- [x] Falha fechada: sem Supabase e sem modo demonstração, tudo recusa; falha de rede não finge logout nem concede acesso.
- [x] Cabeçalhos: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security` (testados no E2E).
- [x] Administrador criado e logado; `/portal` → `/admin`; logout; rota protegida (testes manuais do usuário).

## B. Segurança — pendente

| # | Item | Quem | Quando |
|---|---|---|---|
| 1 | **Girar as chaves do projeto de desenvolvimento** (`sb_secret_` e `sb_publishable_`): os valores apareceram no registro da sessão de trabalho quando o `.env.local` foi lido. Risco baixo (projeto só de desenvolvimento), mas é higiene simples. Project Settings > API Keys; depois atualizar o `.env.local`. | Você | Quando quiser |
| 2 | **Content-Security-Policy** não está definida no `next.config.ts`. Avaliar uma CSP (com nonce para os scripts do Next) e testar no E2E. | Eu | Fase 4 |
| 3 | **Limite de tentativas** de login e do código de verificação do link (item 8 das regras de segurança do `CLAUDE.md`): hoje só valem os limites do próprio Supabase Auth. | Eu | Módulo 4 / Fase 4 |
| 4 | **Tokens na URL e logs.** O `token_hash` do convite/recuperação (`/auth/invite?token_hash=…`) e o token de `/aprovar/[token]` aparecem no caminho/consulta da requisição; o `next dev` os imprime no log (vimos isso), e logs de acesso de hospedagem costumam registrá-los. Mitigações: uso único, expiração curta, só o **hash** no banco, `referrer: no-referrer`. Conferir o que os logs da Vercel guardam e a retenção. | Você + Eu | Antes do lançamento |
| 5 | **Política de senha no Auth** (mínimo 10, letras e números) e **proteção contra senhas vazadas** (exige plano Pro): conferir no painel; a regra do app já vale, a do painel protege o uso direto da API. Não verificado pelo assistente. | Você | Antes do lançamento |
| 6 | **MFA (TOTP) para administradores** do Supabase e das contas Vercel/GitHub/Resend; avaliar MFA no login do app para o papel `admin`. | Você | Antes do lançamento |
| 7 | **`npm audit --omit=dev`:** 6 achados (2 baixos, 4 moderados), todos na cadeia da CLI `shadcn` (`ts-morph`, `minimatch`, `deepmerge`), que hoje está em `dependencies`. Nenhum em código de execução do app. Avaliar mover `shadcn` para `devDependencies` (conferir que a build na Vercel ainda funciona) e reauditar. | Eu | Antes do lançamento |
| 8 | **Validação do conteúdo dos uploads** (assinatura do arquivo, não só o tipo declarado), URLs assinadas de curta duração e varredura básica. | Eu | Módulo 3 |
| 9 | **Fluxo do link seguro**: token de alta entropia, código de verificação por e-mail validado no servidor, tentativas limitadas, sessão curta, revogação e expiração (funções do banco já existem; falta o servidor). | Eu | Módulo 4 |
| 10 | **Backups e recuperação:** confirmar no plano contratado do projeto de produção o que existe de backup diário e de recuperação a um ponto no tempo (PITR) — não verificado pelo assistente. Definir a política de backup e **testar uma restauração**. | Você | Antes do lançamento |
| 11 | **LGPD:** dados de clientes e aprovadores são dados pessoais. Definir base legal/aviso de privacidade, retenção, quem acessa e como atender pedidos de exclusão (usuários são desativados, não apagados; decisões e auditoria são imutáveis: documentar essa decisão). | Você | Antes do lançamento |
| 12 | **Defeito na demonstração de produção:** o menu do usuário da `main` tem o mesmo `DropdownMenuLabel` fora de grupo (erro ao abrir). Corrigir só com deploy autorizado (hotfix na `main` ou ao publicar a Fase 2). | Você decide | Quando houver deploy |

## C. E-mail e domínio

- [ ] SMTP próprio do Supabase com o Resend, modelos em português e teste de recuperação ponta a ponta (`docs/EMAIL-RESEND.md`). **Você** (painéis) / **Eu** (teste).
- [ ] Confirmar no Resend que `luvicompany.com.br` está Verified; criar chaves separadas por ambiente. **Você**.
- [ ] Confirmar a caixa `admin@luvicompany.com.br` na Hostinger (MX do domínio), para receber a recuperação. **Você**.
- [ ] DMARC `p=none` → `quarantine`/`reject` só depois de monitorar. **Você**.

## D. Lançamento (só depois dos Módulos 3 e 4 e da validação deles)

1. [ ] **Projeto Supabase de produção novo** (não promover o de desenvolvimento). **Você**.
2. [ ] Aplicar as 4 migrations, na ordem, uma por vez; rodar `supabase/preflight.sql` antes e `supabase/verify.sql` depois (todos os blocos com 0). Escolher "Run without RLS" no aviso do SQL Editor para manter o texto revisado. **Você** ou **Eu** com autorização expressa.
3. [ ] Auth do projeto de produção: cadastro livre **desligado**, `Site URL = https://aprova.luvicompany.com.br`, Redirect URLs só `https://aprova.luvicompany.com.br/auth/*`, política de senha, SMTP Resend, modelos, limites. **Você**.
4. [ ] Primeiro administrador de produção: `scripts/bootstrap-admin.mjs` em simulação, depois `--check-connection`, depois `--execute --project-host <ref-de-produção>.supabase.co --allow-production` com `APP_URL=https://aprova.luvicompany.com.br`. O link de convite deve aparecer só no terminal. **Você** + **Eu**.
5. [ ] Vercel (projeto `aprova-luvi`): variáveis `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (Sensitive), `APP_URL` **somente no escopo Production**; **sem** `APROVA_DEMO_MODE`; nunca as chaves do projeto de desenvolvimento nem as do projeto `system`. **Você**.
6. [ ] Telas conectadas ao banco real (Módulos 3 e 4); remover o aviso amarelo de dados de demonstração e os dados em `src/lib/mock` do caminho de produção. **Eu**.
7. [ ] Antes de publicar: `npm run check`, `npm run test:db`, build e E2E em diretório isolado (`CLAUDE.md`), `npm audit`. **Eu**.
8. [ ] Publicar a partir de uma branch revisada (PR para `main`), com revisão do diff. Não implantar a `fase-2` como Preview antes de configurar o ambiente (sem Supabase e sem demonstração ela falha fechada e a demonstração some). **Você**.
9. [ ] Testes de fumaça em produção: login do administrador, recuperação de senha por e-mail, convite de aprovador, aprovação por portal e por link, upload e visualização protegida, logout, rota protegida sem sessão. **Você** + **Eu**.
10. [ ] Plano de retorno: guardar o deploy atual da demonstração para promover de volta pela Vercel; documentar quem decide e como. **Você**.
11. [ ] Monitoramento: alertas de erro (5xx), falhas de login, uso do Supabase/Storage/Auth; revisar `audit_events` por administradores. **Você** + **Eu**.

## E. Operação e ambiente de desenvolvimento

- [x] Projeto de desenvolvimento isolado (só `http://localhost:3000`), sem dados de clientes reais.
- [~] Timeouts de conexão: causa identificada como **rede local** (`docs/DIAGNOSTICO-REDE.md`). Falta confirmar em outra rede e corrigir o roteador/Wi-Fi. **Você**.
- [ ] Atualizar este checklist a cada módulo concluído e registrar a validação em `docs/VALIDACAO-FASE-2.md` (ou no documento da fase seguinte).
