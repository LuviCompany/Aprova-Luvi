# Aprova Luvi — guia de produção (Supabase separado + Vercel + Resend)

Estado em **2026-11-04**. O sistema está **tecnicamente pronto para configuração**; **nada foi publicado e o banco de produção ainda não existe**. Este guia é a ordem exata do que fazer, com o que é seu (painéis, DNS, decisões) e o que o repositório já faz. Regra de ouro: **produção só com autorização expressa**; o ambiente de desenvolvimento ("DB Aprova Luvi") nunca vira produção.

## 1. Antes de começar

| Item | Decisão/necessidade |
|---|---|
| Projeto Supabase de produção | **NOVO e separado** do dev (nunca reaproveitar o "DB Aprova Luvi"). Plano **Pro** recomendado: backups diários, recuperação a um ponto no tempo (PITR) e proteção contra senhas vazadas. Região mais próxima dos usuários (São Paulo). |
| Domínio | `aprova.luvicompany.com.br` apontando para a Vercel |
| E-mail | Resend com o domínio verificado (SPF, DKIM e DMARC): `docs/EMAIL-RESEND.md` |
| Primeiro administrador | e-mail da pessoa responsável (criado uma vez, por convite, no seu terminal) |

## 2. Banco de dados (projeto Supabase de produção)

1. **Banco vazio:** rode `supabase/preflight.sql` (deve acusar banco vazio) e confira que nenhum outro app usa este projeto.
2. **Migrations, uma por vez, na ordem** (SQL Editor; confira o SHA-256 do texto colado contra `docs/MIGRACOES-*.md`; pare em qualquer aviso ou divergência):
   `20261102120000_core_schema` → `…120100_functions` → `…120200_rls_policies` → `…120300_storage` → `20261103120000_integrity_clients_projects` → `…120100_approvers_multi_client` → `…120200_approver_invites` → `…120300_audit_clients_projects_approvers` → `20261104120000_materials_content_and_guards` → `…120100_audit_materials` → `20261105120000_material_files_rules` → `…120100_version_contents_and_revision` → `20261106120000_approval_per_approver` (D1) → `…120100_approval_link_flow` (D2) → `20261107120000_approvers_portal_own_rows` (D3).
   No aviso "creates tables without enabling RLS" da primeira (esperado, a RLS vem na terceira): escolha "Run without RLS". A migration 3 revoga privilégios em todo o schema `public`: **nunca** aplicar em projeto compartilhado.
3. **`supabase/verify.sql`:** 31 blocos, **todos em 0**. Se algum não zerar, não prossiga.
4. O bucket privado `materials` (limite de tamanho e tipos MIME) é criado pela migration de storage; confirme no painel que **não é público**.

## 3. Autenticação (Authentication no painel)

| Ajuste | Valor |
|---|---|
| Permitir novos cadastros (sign up) | **Desligado** (contas só por convite) |
| Site URL | `https://aprova.luvicompany.com.br` |
| Redirect URLs | `https://aprova.luvicompany.com.br/auth/*` (e **nenhuma** de localhost) |
| Validade do link de e-mail (OTP expiry) | **86400 s (24 h)**: o convite diz "24 horas" |
| Senha | mínimo **12** caracteres, com maiúsculas, minúsculas, números e símbolos (igual à regra do app, `src/lib/auth/password.ts`); **proteção contra senhas vazadas** ligada (Pro) |
| JWT expiry / rotação do refresh token | 3600 s / ligada |
| SMTP próprio (Resend) | host `smtp.resend.com`, usuário `resend`, senha = chave de API do Resend, remetente do domínio verificado: **necessário** para a recuperação de senha e para editar os modelos |
| Modelos de e-mail | colar `supabase/templates/invite.html` e `recovery.html` (usam `{{ .RedirectTo }}`) |
| MFA | ativar TOTP para as contas de administrador do Supabase, Vercel, GitHub e Resend |

## 4. Primeiro administrador

No **seu Terminal** (a saída não é lida pelo assistente), com `SUPABASE_URL`, `SUPABASE_SECRET_KEY` e `APP_URL=https://aprova.luvicompany.com.br` **apenas no ambiente do terminal**:

```bash
node scripts/bootstrap-admin.mjs --email voce@luvicompany.com.br --name "Seu Nome" --execute --allow-production --project-host <host-do-projeto>.supabase.co
```

O link impresso é de uso único e vale como senha: abra você mesmo. **Outros administradores, designers e atendimento** são convidados depois pela tela **Usuários → Adicionar usuário** (só administrador; a pessoa cria a própria senha pelo e-mail; migration 17, `docs/PRODUCAO-BANCO.md` seção 6). **Depois disso, todo cliente e aprovador novo é cadastrado e convidado pelo painel** (Preparar convite → Enviar convite): nada de terminal.

## 5. Resend

- Domínio verificado (SPF/DKIM/DMARC) e chave de API com permissão **só de envio**, restrita ao domínio.
- `EMAIL_FROM` num endereço do domínio verificado (ex.: `Aprova Luvi <aprovacao@luvicompany.com.br>`).
- O app trata: 429 (aguardar), 4xx (recusa: confira domínio/remetente), 5xx/rede (tentar de novo), com idempotência no convite. Em qualquer falha, o convite é **desfeito** (sem conta órfã) e a equipe vê a mensagem.
- Antes do lançamento, **um e-mail real de teste para você** (convite + código do link), com a sua autorização.

## 6. Vercel (somente o ambiente Production)

| Variável | Valor |
|---|---|
| `SUPABASE_URL` | URL do projeto de **produção** |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` de produção |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` de produção (**segredo**, só servidor) |
| `APP_URL` | `https://aprova.luvicompany.com.br` |
| `APPROVAL_LINK_SECRET` | 32+ caracteres aleatórios, **diferente do dev** (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `EMAIL_PROVIDER` | `resend` |
| `RESEND_API_KEY` | chave do Resend (**segredo**) |
| `EMAIL_FROM` | remetente do domínio verificado |

**Nunca** definir em produção: `APROVA_DEMO_MODE`, `E2E_SIMULATED_EMAIL`, `EMAIL_PROVIDER=simulated`. Ambientes de *Preview* não podem apontar para o banco de produção (use o projeto de desenvolvimento ou deixe sem variáveis). Antes de publicar: `npm run env:check:prod` com as variáveis de produção no terminal (não carrega o `.env.local`: use variáveis só na sessão do terminal; passo a passo em `docs/VERCEL-PRODUCAO.md`): **precisa terminar em "Configuração válida"**.

## 7. Teste de fumaça pós-publicação (com dados fictícios)

1. Login do administrador; criar cliente "TESTE" e um aprovador com **o seu e-mail**.
2. Preparar e **Enviar convite**; abrir o e-mail, criar a senha, entrar no portal.
3. Subir um arquivo, enviar para aprovação, aprovar e pedir alteração pelo portal e pelo link rápido (código por e-mail).
4. Conferir o painel, a auditoria (sem dados pessoais) e que o usuário de um cliente não vê outro (`/portal/materiais/<id de outro cliente>` → "não encontrada").
5. Logs da Vercel: nenhum token, código ou senha. Depois, arquivar o cliente de teste.

## 8. Operação

- **Backups/PITR:** confirme no plano contratado e **teste uma restauração** antes de ter dados reais. No plano **Free** não há backup automático e o Storage nunca entra no backup do banco: use a rotina cifrada de `docs/BACKUP.md` (banco, arquivos, verificação, ensaio de restauração e frequência).
- **Arquivos órfãos:** `node --env-file=… scripts/cleanup-storage-orphans.mjs` (relatório por padrão; `--execute` só com `--project-host`; só apaga o que nenhum registro usa e é mais antigo que 24 h). Rodar mensalmente.
- **Rotação de segredos:** `APPROVAL_LINK_SECRET` (invalida códigos e sessões em curso; links seguem válidos), chaves do Supabase e do Resend; o assistente nunca lê o `.env.local`.
- **Logs:** o token do link rápido está no caminho `/aprovar/<token>`; ele sozinho **não aprova** (exige o código do e-mail), mas **não** grave URL completa de `/aprovar/*` em *log drain*/analytics.
- **IP real:** na Vercel o `X-Forwarded-For` vem do proxy da plataforma; fora dela, só confie nele atrás de um proxy seu.
- **Retenção de auditoria e LGPD:** `docs/AUDITORIA.md` (proposta a validar com a assessoria jurídica).

## 9. Revisão de segurança do lançamento (resumo, com evidência)

| Controle | Como está | Evidência |
|---|---|---|
| Convite/ativação sem terminal | Server Action → serviço com chave secreta só no servidor; o aprovador cria a própria senha; desfaz tudo se o e-mail falhar | `src/lib/invites/service.test.ts` (12), UI e ação |
| Chave secreta | só em `src/lib/link-approval/`, `src/lib/invites/` e scripts | `src/test/no-secret-key.test.ts` |
| Tokens do link | 256 bits, só o SHA-256 no banco; código HMAC; 5 tentativas, 1/min, 5/h; sessão 30 min | `approval-multi.test.ts`, validação no dev |
| Cookies | `httpOnly`, `SameSite=Lax`, `Secure` em produção, caminho `/aprovar`, nome por link | `cookie.test.ts` |
| Cabeçalhos | HSTS, nosniff, X-Frame-Options, Permissions-Policy, `no-referrer`/`no-store`/`noindex` em `/aprovar`, **CSP** montada no proxy a partir do ambiente | `security-headers*.test.ts`, E2E |
| Logs | token, código e senha não vão para log; dev não imprime argumentos de Server Functions | testes de log, `next.config.ts` |
| RLS e isolamento | teste dirigido pelo catálogo (toda tabela com `client_id`, storage e segredos do link); o aprovador lê só a própria linha de `approvers` (D3) | `isolation-catalog.test.ts`, `approvers-privacy.test.ts`, validação no dev |
| Aninhamentos do PostgREST | todo `pai(filha)` dos selects existe como chave estrangeira | `postgrest-embeds.test.ts` |
| Arquivos privados | bucket privado, URL assinada de 60 s por rota protegida; outra empresa recebe 404 | E2E e validação no dev |
| E-mail | Resend com idempotência e erros classificados; simulado recusado em produção | `email.test.ts`, `env-production.test.ts` |
| Configuração | `npm run env:check:prod` transforma avisos em erros | `env-production.test.ts` |
