# Checklist de segurança e lançamento — Aprova Luvi

Estado em **2026-11-02**, ao fim da validação da Fase 2 (Módulos 1 e 2). Legenda: `[x]` feito e evidenciado, `[ ]` pendente, `[~]` parcial. Quem: **Você** (painéis, DNS, decisões), **Eu** (código/testes, se autorizado).

> Regra de ouro: **nada vai para produção sem autorização expressa**. A produção atual é a demonstração da Fase 1 (branch `main`, `aprova.luvicompany.com.br`).

## 0. Preparação para o lançamento (2026-11-04) — leia esta seção primeiro

O sistema está **tecnicamente pronto para configuração**; **nada foi publicado, o banco de produção não existe e nenhuma migration foi aplicada fora do projeto de desenvolvimento**. O passo a passo completo está em `docs/PRODUCAO.md`.

**Preparado no código (testado):** convite e ativação de aprovadores pelo painel (sem terminal); Resend com modelos HTML/texto, idempotência e erros classificados; `npm run env:check:prod` (avisos viram erros); CSP montada em tempo de execução; teste de isolamento dirigido pelo catálogo (toda tabela com `client_id`, storage e segredos do link); aprovador lê só a própria linha de `approvers` (D3); script de limpeza segura de arquivos órfãos; guia de produção e revisão de segurança.

**O que VOCÊ precisa fazer (nesta ordem):**

| # | Ação | Onde |
|---|---|---|
| L1 | Criar o projeto Supabase de **produção** (novo, plano Pro, região São Paulo) e guardar as chaves | Supabase |
| L2 | Aplicar as 15 migrations **uma por vez** + `verify.sql` (31 blocos em 0), conforme `PRODUCAO.md` seção 2 (posso aplicar com a sua autorização expressa) | SQL Editor |
| L3 | Configurar a autenticação: sem cadastro livre, URLs de produção, validade do link de e-mail **24 h**, senha forte e proteção contra senha vazada, SMTP do Resend, modelos de e-mail, MFA nos administradores | Supabase Auth |
| L4 | Resend: domínio verificado (SPF/DKIM/DMARC), chave **só de envio**, remetente do domínio (`docs/EMAIL-RESEND.md`) | Resend/DNS |
| L5 | Vercel: variáveis de produção (`PRODUCAO.md` seção 6), domínio, e `npm run env:check:prod` terminando em "Configuração válida" | Vercel |
| L6 | Criar o primeiro administrador **no seu terminal** (`bootstrap-admin`, uma vez). Depois, tudo pelo painel | Terminal |
| L7 | Teste de fumaça com **um e-mail real seu** (convite + código do link), com a sua autorização | App publicado |
| L8 | Confirmar backups/PITR e **testar uma restauração**; definir quem acompanha logs | Supabase/Vercel |
| L9 | LGPD: aviso de privacidade, retenção e política de exclusão (itens 10 e 11 da seção B) | Jurídico |

**Operações remotas pendentes:** criar o projeto de produção (L1), aplicar migrations e configurações (L2, L3), publicar (L5). **Nenhuma foi feita.**

**Riscos de lançamento conhecidos:** (1) o e-mail real (Resend) ainda **nunca foi chamado de verdade**: o teste L7 é obrigatório; (2) sem teste de restauração de backup; (3) o token do link rápido fica no caminho da URL e pode aparecer nos logs da hospedagem (o token sozinho não aprova; não use *log drain* com URL completa de `/aprovar/*`); (4) a recuperação de senha depende do SMTP do Supabase (L3) e nunca foi testada com e-mail real; (5) o limite de tentativas de **login** é só o do Supabase Auth; (6) CSP com `unsafe-inline` nos scripts (o Next precisa), sem nonce.

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
| 3 | **Limite de tentativas** de login e do código de verificação do link (item 8 das regras de segurança do `CLAUDE.md`). **Código do link: implementado** (5 tentativas por código, 1 código/min e 5/hora por link no banco, mais limite por IP em memória; D2, testado localmente). Login: continuam só os limites do Supabase Auth. Falta validar no banco real e, no login, avaliar limite próprio. | Eu | Fase 4 |
| 4 | **Tokens na URL e logs.** O `token_hash` do convite/recuperação (`/auth/invite?token_hash=…`) e o token de `/aprovar/[token]` aparecem no caminho/consulta da requisição; o `next dev` os imprime no log (vimos isso), e logs de acesso de hospedagem costumam registrá-los. Mitigações: uso único, expiração curta, só o **hash** no banco, `referrer: no-referrer`. Conferir o que os logs da Vercel guardam e a retenção. | Você + Eu | Antes do lançamento |
| 5 | **Política de senha no Auth** (mínimo 12, maiúsculas, minúsculas, números e símbolos) e **proteção contra senhas vazadas** (exige plano Pro): conferir no painel; a regra do app já vale, a do painel protege o uso direto da API. Não verificado pelo assistente. | Você | Antes do lançamento |
| 6 | **MFA (TOTP) para administradores** do Supabase e das contas Vercel/GitHub/Resend; avaliar MFA no login do app para o papel `admin`. | Você | Antes do lançamento |
| 7 | **`npm audit --omit=dev`:** 6 achados (2 baixos, 4 moderados), todos na cadeia da CLI `shadcn` (`ts-morph`, `minimatch`, `deepmerge`), que hoje está em `dependencies`. Nenhum em código de execução do app. Avaliar mover `shadcn` para `devDependencies` (conferir que a build na Vercel ainda funciona) e reauditar. | Eu | Antes do lançamento |
| 8 | **Validação do conteúdo dos uploads** (assinatura do arquivo, não só o tipo declarado), URLs assinadas de curta duração e varredura básica. **Implementado** (assinatura de JPEG/PNG/WebP/PDF/MP4/MOV, tamanho conferido no servidor, URL de envio de uso único e URL de leitura de 60 s; `MODULO-3.md`, seção 13); falta validar no Supabase real e, se desejado, varredura de malware. | Eu | Módulo 3 |
| 9 | **Fluxo do link seguro**: token de 256 bits (só o hash no banco), código por e-mail (HMAC), tentativas limitadas, sessão curta em cookie `httpOnly`, revogação e expiração. **Implementado e testado localmente** (`MODULO-4.md`; E2E com e-mail simulado). Falta: aplicar D1/D2 (item 17), SMTP real (item 18) e validar com dados fictícios no projeto de desenvolvimento. | Eu | Módulo 4 |
| 10 | **Backups e recuperação:** confirmar no plano contratado do projeto de produção o que existe de backup diário e de recuperação a um ponto no tempo (PITR) — não verificado pelo assistente. Definir a política de backup e **testar uma restauração**. | Você | Antes do lançamento |
| 11 | **LGPD:** dados de clientes e aprovadores são dados pessoais. Definir base legal/aviso de privacidade, retenção, quem acessa e como atender pedidos de exclusão (usuários são desativados, não apagados; decisões e auditoria são imutáveis: documentar essa decisão). | Você | Antes do lançamento |
| 12 | **Defeito na demonstração de produção:** o menu do usuário da `main` tem o mesmo `DropdownMenuLabel` fora de grupo (erro ao abrir). Corrigir só com deploy autorizado (hotfix na `main` ou ao publicar a Fase 2). | Você decide | Quando houver deploy |

### B.2 Endurecimentos de banco propostos no Módulo 3 (etapa A) — dependem de migration autorizada

| # | Item | Quando |
|---|---|---|
| 13 | Trigger recusando projeto novo em cliente arquivado (hoje só a Server Action recusa) | Antes do lançamento |
| 14 | Índice único `(organization_id, lower(btrim(name)))` para clientes (hoje "Casa Aurora" e "casa aurora" coexistem no banco) | Antes do lançamento |
| 15 | Auditoria (`audit_events`) de criar, editar e arquivar clientes e projetos | Antes do lançamento / Fase 4 |
| 16 | Cadastro de aprovadores na interface (a RLS já permite): pré-requisito do Módulo 4 | Início do Módulo 4 |

**Atualização (A.2):** os itens 13, 14 e 15 e o 16 estão **implementados** nas migrations M1 a M4 (`docs/MIGRACOES-A2.md`) e no app, e as migrations foram **aplicadas no projeto de desenvolvimento em 2026-11-03** com `verify.sql` de 22 blocos em 0. O teste manual com dados fictícios foi **aprovado em 2026-11-03** (`docs/MODULO-3.md`, seção 11). Pendente: repetir o procedimento no projeto de produção quando existir. A política de retenção da auditoria é uma **proposta** a validar com a assessoria jurídica (`docs/AUDITORIA.md`).

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

### B.3 Módulo 4 — pendências para validar e lançar

| # | Item | Quem | Quando |
|---|---|---|---|
| 17 | **D1 e D2 APLICADAS no projeto de desenvolvimento em 2026-11-04** (uma por vez, hashes de `MIGRACOES-D.md`; `verify.sql` 30/30 em 0). Falta repetir no projeto de produção quando existir e exercitar o fluxo num banco real: as consultas aninhadas do PostgREST (`approvers(...)`, `decisions(...)`, `material_versions(number, materials(title))`) só foram checadas por tipos e por mocks. | Você autoriza / Eu aplico | Próximo passo |
| 18 | **SMTP/Resend** (`docs/EMAIL-RESEND.md`): sem provedor, o código do link não é enviado e o link não conclui. Configurar `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` e `EMAIL_FROM` (domínio verificado) e testar com **um e-mail seu**, com autorização. O envio real pelo Resend está implementado mas **nunca foi chamado de verdade**. | Você + Eu | Antes do lançamento |
| 19 | **`APPROVAL_LINK_SECRET`** (≥ 32 caracteres aleatórios) em cada ambiente, só no servidor, diferente entre dev e produção. Trocar invalida códigos e sessões em curso (links seguem válidos). | Você | Ao configurar o ambiente |
| 20 | **Proteção de logs** (a validação achou e corrigiu o log do `next dev`, que imprimia token e código nos argumentos das Server Functions; agora desligado em `next.config.ts`): o token do link está no caminho da URL e pode ser gravado nos logs de acesso da hospedagem (Vercel). O app não registra token, código nem sessão (testado), e o token sozinho não aprova (exige o código do e-mail), mas confira retenção/filtros dos logs, desligue log drains que gravem URL completa e considere mascarar `/aprovar/*`. | Você + Eu | Antes do lançamento |
| 21 | **IP real do cliente:** o limite por IP e o IP em HMAC da auditoria usam `X-Forwarded-For`. Confirmar na hospedagem que esse cabeçalho vem do proxy confiável (não do cliente). Os limites por link no banco valem de qualquer forma. | Você + Eu | Antes do lançamento |
| 22 | **Validação operacional com dados fictícios** no projeto de desenvolvimento: **aprovada em 2026-11-04** (`MODULO-4.md`, seção 7; envio, link com código, bloqueio por tentativas, política "todos aprovam", alteração, revisão, reenvio, revogação, cancelamento e auditoria sem dados pessoais). Falta a decisão **no portal** com um login real de aprovador e o envio real de e-mail. | Você (login de aprovador) + Eu | Antes do lançamento |
| 23 | **Rota de depuração** `/api/dev/outbox`: só responde com `EMAIL_PROVIDER=simulated`, que é recusado em produção (exceto `E2E_SIMULATED_EMAIL=true` com `APP_URL` de localhost, usado só no E2E). Nunca definir essas variáveis em produção. | Você | Ao configurar produção |
| 24 | **Notificações** (novo material, lembrete de prazo) ficam para a Fase 3; hoje o aprovador só recebe o link que a equipe gera. | Eu | Fase 3 |
