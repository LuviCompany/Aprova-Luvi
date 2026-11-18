# Vercel — configuração de produção (sem expor credenciais)

Projeto Vercel `aprova-luvi` (equipe Luvi Company, plano Hobby). A branch de produção é a **`main`** (hoje a demonstração antiga) e o domínio é `aprova.luvicompany.com.br`. **Nada aqui altera o site no ar:** variáveis novas só valem para deploys novos.

## 1. Variáveis (nomes exatos) — só no ambiente **Production**

| Nome | Valor | Segredo? |
|---|---|---|
| `SUPABASE_URL` | `https://nvtiynmebffxctqlrwqo.supabase.co` | não |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` do projeto **de produção** (Project Settings → API Keys) | não (é pública) |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` do projeto **de produção** | **sim: Sensitive** |
| `APP_URL` | `https://aprova.luvicompany.com.br` | não |
| `APPROVAL_LINK_SECRET` | 64 caracteres hexadecimais aleatórios, **novos**, diferentes dos de desenvolvimento | **sim: Sensitive** |
| `EMAIL_PROVIDER` | `resend` | não |
| `RESEND_API_KEY` | chave do Resend **só para o app** (permissão só de envio, restrita ao domínio); **não** reutilize a chave do SMTP do Supabase | **sim: Sensitive** |
| `EMAIL_FROM` | no formato `Aprova Luvi <ENDEREÇO>`, com ENDEREÇO = `admin@luvicompany.com.br` (remetente já validado no domínio verificado; o mesmo valor do `.env.local`, que não é segredo) | não |

**Nunca** definir: `APROVA_DEMO_MODE`, `E2E_SIMULATED_EMAIL`, `NEXT_PUBLIC_*`, nomes legados (`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) nem **qualquer valor de produção nos ambientes Preview e Development**.

### Como cadastrar sem expor valores
No painel: Project → Settings → Environment Variables → Add. Em cada variável marque **apenas "Production"**; nos três segredos ligue **Sensitive** (depois de salva, nem você consegue ler de novo). Cole o valor direto no campo; nunca em chat, ticket ou arquivo.

Gerar o `APPROVAL_LINK_SECRET` novo **sem exibi-lo** (PowerShell: copia para a área de transferência; cole no campo da Vercel e limpe a área de transferência):

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
(($b | ForEach-Object { $_.ToString("x2") }) -join "") | Set-Clipboard
# ... colar na Vercel ...
Set-Clipboard -Value " "
```

Rotacionar `APPROVAL_LINK_SECRET` depois invalida só códigos e sessões em curso (links seguem válidos).

## 2. Verificação `env:check:prod` (antes de publicar)
A checagem de lançamento **recusa** `SUPABASE_URL` que não seja o projeto de produção (`nvtiynmebffxctqlrwqo.supabase.co`) e `APP_URL` que não seja `https://aprova.luvicompany.com.br`, além de e-mail simulado, demo ligada, segredo curto e localhost. Ela **não carrega o `.env.local`** e não abre conexão. No **seu** PowerShell, com as variáveis só na sessão (valores digitados de forma oculta):

```powershell
cd "C:\Users\redme\OneDrive\Área de Trabalho\Sistemas\Aprova Luvi\aprova-luvi"
function Read-Secret($nome) { $s = Read-Host $nome -AsSecureString; [System.Net.NetworkCredential]::new("", $s).Password }
$env:SUPABASE_URL = "https://nvtiynmebffxctqlrwqo.supabase.co"
$env:APP_URL = "https://aprova.luvicompany.com.br"
$env:SUPABASE_PUBLISHABLE_KEY = Read-Secret "SUPABASE_PUBLISHABLE_KEY (producao)"
$env:SUPABASE_SECRET_KEY = Read-Secret "SUPABASE_SECRET_KEY (producao)"
$env:APPROVAL_LINK_SECRET = Read-Secret "APPROVAL_LINK_SECRET (producao)"
$env:EMAIL_PROVIDER = "resend"
$env:RESEND_API_KEY = Read-Secret "RESEND_API_KEY (producao)"
$env:EMAIL_FROM = "Aprova Luvi <" + "admin@luvicompany.com.br" + ">"
npm run env:check:prod
```

Resultado esperado: `supabaseHost nvtiynmebffxctqlrwqo.supabase.co`, `siteUrl https://aprova.luvicompany.com.br`, `emailProvider resend`, `linkSecret definido`, `demoMode false` e **"Configuração válida."** (nenhum valor secreto é impresso). Depois: `Remove-Item Env:SUPABASE_URL,Env:APP_URL,Env:SUPABASE_PUBLISHABLE_KEY,Env:SUPABASE_SECRET_KEY,Env:APPROVAL_LINK_SECRET,Env:EMAIL_PROVIDER,Env:RESEND_API_KEY,Env:EMAIL_FROM`.

## 3. Preview protegido antes de atualizar a `main`

Regras: Preview e Development **sem** valores de produção (o Preview nunca toca o banco de produção); proteção de deploy da Vercel ligada.

1. **Proteção:** Project → Settings → Deployment Protection → **Vercel Authentication** ligada (Standard Protection: URLs de deploy só abrem para quem está logado na equipe). *Não foi possível ler esta tela pelo assistente: confirme.*
2. **Push da `fase-2` (só quando você autorizar):** gera um Preview **sem variáveis**. Ele falha fechado ("ambiente não configurado") e a demonstração de produção não muda. Serve só para provar que o **build** passa na Vercel.
3. **Ensaio com as variáveis reais, sem expor o domínio:** com as variáveis do item 1 já salvas em Production, publique **o mesmo commit** como deploy de produção **sem atribuir o domínio** (Vercel CLI: `vercel deploy --prod --skip-domain`, depois de `vercel login`; confira as flags com `vercel deploy --help`). O deploy ganha uma URL própria, protegida pela Vercel Authentication, e o domínio continua na demonstração. Nessa URL verifique, sem login: `/login` abre sem aviso de "ambiente não configurado"; `/admin` e `/portal` redirecionam ao login; `/aprovar/<token falso>` mostra "Link inválido" (e não "indisponível"); cabeçalhos de segurança presentes.
4. **Limite do ensaio:** os e-mails de convite e recuperação apontam para `APP_URL` (o domínio oficial), então o fluxo de convite/senha só pode ser provado **depois de promover**. Por isso a ordem é: ensaio (item 3) → promover → criar o administrador (`bootstrap-admin`, que também pode ser retomado se o link expirar) → teste de fumaça de `docs/PRODUCAO.md`, seção 7.
5. **Plano de retorno:** antes de promover, anote o deploy atual da demonstração (Deployments → o de Production atual). Para voltar: Deployments → esse deploy → *Promote* / *Instant Rollback*. O banco de produção é novo e vazio, então voltar não perde dados.
6. **Só então** atualizar a `main` (merge da `fase-2`, com a sua confirmação do commit final); a Vercel publica a `main` com as variáveis de Production.

## 4. Lista de conferência (marque você)
- [ ] 8 variáveis só em Production; 3 como Sensitive; nenhuma no Preview/Development.
- [ ] `APPROVAL_LINK_SECRET` novo (não é o de desenvolvimento) e `RESEND_API_KEY` própria do app.
- [ ] `npm run env:check:prod` terminou em "Configuração válida."
- [ ] Vercel Authentication ligada; 2FA ligado na conta Vercel (a Vercel mostra o aviso).
- [ ] Deploy da demonstração anotado para o retorno.
- [ ] Decisão sobre o plano (Hobby é para uso não comercial; para a agência, considerar Pro).
