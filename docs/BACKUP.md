# Aprova Luvi — backup e recuperação (produção, plano Free do Supabase)

Estado em **2026-11-18**. O projeto de produção (`nvtjynmebffxctqlrwqo`) está no plano **Free**: **não há backup automático nem recuperação a um ponto no tempo**. O Supabase recomenda, nesse plano, exportar os dados com regularidade; o backup do banco **também não inclui os arquivos do Storage**. Este roteiro cobre o que falta. O banco de desenvolvimento ("DB Aprova Luvi") **não é alvo** de nada aqui.

> **Nada deste roteiro foi executado contra o Supabase real** (pedido expresso) e esta máquina ainda não tem `pg_dump`/`psql`. A parte de arquivos (Node) tem testes automatizados; a parte do PostgreSQL segue a documentação do Supabase e **precisa de um ensaio** (seção 6) antes de você confiar nela. Recomendação: ensaiar primeiro com o projeto de desenvolvimento (só leitura) para achar problemas de comando com dados fictícios.

## 1. O que precisa de backup

| Dado | Onde está | Como é protegido |
|---|---|---|
| Dados do negócio: organizações, perfis, clientes, aprovadores, projetos, materiais, versões, conteúdos congelados, solicitações, decisões, comentários, auditoria (schemas `public` e `app`) | Postgres | `dados.sql` (seção 4.1). **Decisões, versões e auditoria são imutáveis: se forem perdidas, não há como refazê-las.** |
| Contas de login: `auth.users` e `auth.identities` | Postgres (schema `auth`) | `dados.sql`. `profiles.id` aponta para `auth.users.id`: sem as contas, os perfis ficam órfãos. **O arquivo contém hashes de senha: trate como segredo (é cifrado).** |
| Estrutura, funções, políticas RLS e privilégios | Postgres | Reproduzíveis pelas **15 migrations** (imutáveis, SHA-256 em `supabase/sql-manifest.sha256`) + `estrutura.sql` como prova/comparação. |
| Arquivos dos materiais (bucket privado `materials`) | Storage | Espelho local + manifesto SHA-256 (seção 4.2). |
| Configuração fora do banco: Auth (Site URL, Redirect URLs, SMTP, política de senha, cadastro desligado), modelos de e-mail, domínio/DNS e Resend | Painéis | Modelos estão no repositório (`supabase/templates/`); o resto está descrito em `docs/PRODUCAO.md` seções 3 a 6. `inventario.txt` (dentro do backup) registra versões e commit. |
| Segredos (chaves do Supabase, Resend, `APPROVAL_LINK_SECRET`, senha do banco) | Vercel e painéis | **Fora dos backups.** Ficam no gerenciador de senhas; a Vercel não devolve as marcadas como Sensitive. |
| Código | Git | Os commits da `fase-2` hoje só existem **localmente** (nada foi enviado ao GitHub). O push é decisão sua. |

Não precisam de backup: sessões e tokens de refresh (`auth.sessions`, `auth.refresh_tokens`), metadados de `storage.objects` (recriados ao enviar os arquivos) e logs.

## 2. Regras de segurança

- Backups contêm dados de clientes e hashes de senha. **Cifrados sempre** (AES-256-GCM, `scripts/backup-tools.mjs`), em disco local cifrado e **fora do repositório e do OneDrive** (os scripts recusam essas pastas). Não use `.env.local`: nenhum script daqui o lê.
- Senhas só **na sessão** do PowerShell, digitadas de forma oculta; nada é impresso, gravado ou versionado. A senha do backup fica no gerenciador de senhas, **separada** dos arquivos: sem ela o backup é irrecuperável.
- Tudo é **somente leitura** no Supabase (`pg_dump`, `SELECT`, listar/baixar arquivos). A única escrita remota possível é `storage-restore --execute`, só para projeto de destino, com confirmação do host e **sem sobrescrever** objetos.
- Os scripts apagam apenas os temporários em texto claro que eles mesmos criaram. Rodízio de backups antigos é manual.

## 3. Preparação (uma vez)

1. **Ferramentas do PostgreSQL** (`pg_dump` e `psql`; `initdb`/`pg_ctl` para o ensaio). É a única dependência nova, e não há como obter dump fiel do `auth` sem ela. Use o pacote oficial de binários (ZIP, sem serviço) ou o instalador marcando só *Command Line Tools*, com a **versão principal igual ou maior** que a do servidor (`select version()` no SQL Editor, leitura). Coloque a pasta `bin` no PATH e confirme:
   ```powershell
   pg_dump --version; psql --version; tar --version
   ```
2. **Conexão:** painel Supabase → *Connect* → **Session pooler** (porta 5432; funciona sem IPv6). Copie só o **host** (`...pooler.supabase.com`). Se der timeout, rode `npm run net:check` (`docs/DIAGNOSTICO-REDE.md`).
3. **Destino:** uma pasta local fora do OneDrive, em disco cifrado (Windows Home: Configurações → Privacidade e segurança → *Criptografia de dispositivo*, se disponível) e, para a regra 3-2-1, uma **segunda cópia** dos arquivos `.sealed` em outro lugar (HD externo ou nuvem: já estão cifrados).
4. **Senha do backup:** gere sem exibir, cole no gerenciador de senhas e limpe a área de transferência:
   ```powershell
   $b = New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b) | Set-Clipboard
   ```
   ```powershell
   Set-Clipboard -Value " "
   ```

## 4. Rotina de backup

Na raiz do repositório, no **seu** PowerShell.

### 4.1 Banco (dados, estrutura, funções, políticas, inventário)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup-db.ps1 -Dest D:\Backups\AprovaLuvi -DbHost <host do Session pooler>
```

O script pede, de forma oculta, a **senha do banco de produção** (Settings → Database; não a mostre em lugar nenhum) e a **senha do backup**. Ele: conta as linhas (`scripts/backup-contagens.sql`), gera `estrutura.sql` (schemas `public`, `app`, `auth`, `storage`, com funções, políticas e privilégios) e `dados.sql` (`public`, `app`, `auth.users`, `auth.identities`, `storage.buckets`, em COPY), confere que o dump terminou, grava `inventario.txt` (commit, hash do manifesto de migrations, versão do servidor, extensões) e copia `sql-manifest.sha256` e os modelos de e-mail; empacota, **cifra**, confere a integridade (`unseal --check`), grava o `.sha256` e apaga o texto claro. Resultado: `aprova-luvi-db-<data>.tar.sealed` + `.sha256`. O `-ExecutionPolicy Bypass` vale só para esse comando.

### 4.2 Arquivos do bucket `materials`

Com as chaves **só na sessão** (a chave `sb_secret_…` é lida do painel/gerenciador; o script recusa chave pública e qualquer projeto que não seja o de produção):

```powershell
function Read-Secret($n) { $s = Read-Host $n -AsSecureString; [Net.NetworkCredential]::new("", $s).Password }
$env:SUPABASE_URL = "https://nvtjynmebffxctqlrwqo.supabase.co"; $env:SUPABASE_SECRET_KEY = Read-Secret "SUPABASE_SECRET_KEY (producao)"
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts\backup-tools.mjs storage-backup --out D:\Backups\AprovaLuvi\storage
```

O espelho (`...\storage\materials\<cliente>\<material>\<versão>\<arquivo>`) **só cresce**: os arquivos são imutáveis no app e nada local é apagado, mesmo que o objeto suma do Supabase. Cada execução grava `manifest-<data>.json` (caminho, tamanho, SHA-256, tipo MIME) e **cruza com `material_files`**: aponta SHA-256 ou tamanho diferentes do registrado, registro sem objeto e objeto sem registro. Qualquer problema termina com erro e o backup não vale. Limpe a sessão: `Remove-Item Env:SUPABASE_URL, Env:SUPABASE_SECRET_KEY`.

Para a cópia fora da máquina, empacote e cifre (a senha vem de `BACKUP_PASSPHRASE`, digitada oculta):

```powershell
$env:BACKUP_PASSPHRASE = Read-Secret "Senha do backup"
tar -cf D:\Backups\AprovaLuvi\storage-$(Get-Date -Format yyyyMMdd).tar -C D:\Backups\AprovaLuvi storage
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts\backup-tools.mjs seal --in D:\Backups\AprovaLuvi\storage-<data>.tar --out D:\Backups\AprovaLuvi\storage-<data>.tar.sealed
```

## 5. Verificação de integridade

- **Espelho do storage** (offline, sem chave): confere existência, tamanho e SHA-256 de cada arquivo contra o manifesto.
  ```powershell
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts\backup-tools.mjs storage-verify --dir D:\Backups\AprovaLuvi\storage
  ```
- **Arquivo cifrado** (sem gravar o conteúdo; falha com senha errada, corrupção ou adulteração):
  ```powershell
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts\backup-tools.mjs unseal --in <arquivo>.sealed --check
  ```
- **Cópia fora da máquina:** compare o SHA-256 com o `.sha256`:
  ```powershell
  (Get-FileHash <arquivo>.sealed -Algorithm SHA256).Hash.ToLower() -eq (Get-Content <arquivo>.sealed.sha256).Split(" ")[0]
  ```
- Só um **teste de restauração** prova o `dados.sql` (seção 6).

## 6. Ensaio de restauração em ambiente isolado

Um PostgreSQL **descartável, local, só em `localhost:54329`**, feito com as mesmas ferramentas (`initdb`, `pg_ctl`); nada toca o Supabase. Faça **antes do lançamento** e depois a cada trimestre.

```powershell
$ens = "D:\Backups\ensaio"; New-Item -ItemType Directory $ens\conteudo -Force | Out-Null
$f = Get-ChildItem D:\Backups\AprovaLuvi -Filter *.tar.sealed | Sort-Object Name | Select-Object -Last 1
$env:BACKUP_PASSPHRASE = Read-Secret "Senha do backup"
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts\backup-tools.mjs unseal --in $f.FullName --out $ens\backup.tar
tar -xf $ens\backup.tar -C $ens\conteudo
```

```powershell
initdb -D $ens\pgdata -U postgres --auth=trust -E UTF8
pg_ctl -D $ens\pgdata -o "-p 54329 -c listen_addresses=localhost" -l $ens\pg.log start
$L = @("-h", "localhost", "-p", "54329", "-U", "postgres", "-X")
```

Papéis e extensões que o Supabase já traz (se `estrutura.sql` reclamar de outro papel/extensão, crie-o e refaça o ensaio do zero):

```powershell
psql @L -c "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role authenticator login noinherit; create role supabase_auth_admin nologin; create role supabase_storage_admin nologin; create role supabase_admin nologin; create role dashboard_user nologin; create schema extensions; create extension if not exists pgcrypto schema extensions; create extension if not exists ""uuid-ossp"" schema extensions;"
```

Estrutura (sem parar no primeiro erro; **leia o log**) e dados (em uma transação, com os gatilhos desligados, como pede a documentação do Supabase):

```powershell
psql @L -f $ens\conteudo\estrutura.sql 2>&1 | Select-String "ERROR" | Tee-Object $ens\erros-estrutura.log
psql @L -v ON_ERROR_STOP=1 --single-transaction -c "set session_replication_role = replica" -f $ens\conteudo\dados.sql
```

**Critérios de aprovação** (todos):

1. `dados.sql` restaurou sem erro.
2. A contagem do banco restaurado é igual à do backup (`diff` vazio; só vale se ninguém gravou entre a contagem e o dump):
   ```powershell
   psql @L -At -F ";" -f scripts\backup-contagens.sql | Set-Content $ens\restaurado.csv -Encoding ascii
   Compare-Object (Get-Content $ens\conteudo\contagens.csv) (Get-Content $ens\restaurado.csv)
   ```
3. A verificação do projeto devolve **31 linhas, todas com `violacoes` = 0** (RLS ligada, `anon` sem privilégios, funções sem `EXECUTE` indevido, bucket privado etc.):
   ```powershell
   psql @L -At -F ";" -f supabase\verify-summary.sql | Where-Object { ($_ -split ";")[-1] -ne "0" }
   ```
   (saída vazia = aprovado; num PostgreSQL puro, analise qualquer linha restante com o bloco de mesmo título em `supabase/verify.sql` antes de concluir).
4. `inventario.txt` registra o commit e o hash do manifesto de migrations esperados.
5. **Arquivos:** `storage-verify` sem problemas e abra, pelo menos, 1 imagem e 1 PDF do espelho.

Encerre e apague o ensaio (contém dados de clientes):

```powershell
pg_ctl -D $ens\pgdata stop; Remove-Item $ens -Recurse -Force; Remove-Item Env:BACKUP_PASSPHRASE
```

**Limite conhecido:** `estrutura.sql` inclui os schemas gerenciados `auth` e `storage`; num PostgreSQL puro eles podem acusar erros por objetos exclusivos do Supabase. Se isso impedir o ensaio, o plano B é um projeto Supabase descartável (o plano Free permite 2 projetos ativos e os dois estão em uso: decisão sua, não pause nem altere o de desenvolvimento sem decidir).

## 7. Recuperação real (resumo; só com sua autorização)

1. **Projeto novo e vazio** (ou o mesmo, se o banco foi perdido): `supabase/preflight.sql`, as **15 migrations** na ordem com SHA-256 conferido e `verify-summary.sql` 31/31 (`docs/PRODUCAO-BANCO.md`). A estrutura vem das migrations, não do `estrutura.sql`.
2. **Dados:** `psql --single-transaction -c "set session_replication_role = replica" -f dados.sql` pela conexão do Session pooler do projeto novo. Esperado: **um erro de chave duplicada em `storage.buckets`** (a migration de storage já criou o bucket; por isso não use `ON_ERROR_STOP` nessa etapa e confira que o bucket continua privado). As contas voltam com os hashes: os usuários mantêm a senha, só perdem as sessões.
3. **Arquivos:** `storage-restore --dir … ` (simulação) e, depois, `--execute --project-host <host novo>`. Só envia o que falta, nunca sobrescreve.
4. **Configuração:** refazer Auth, SMTP e modelos (`docs/PRODUCAO.md` seção 3), atualizar as variáveis da Vercel com o novo `SUPABASE_URL` e as novas chaves e conferir com `npm run env:check:prod`.
5. Teste de fumaça (`docs/PRODUCAO.md` seção 7).

## 8. Frequência sugerida (dois clientes)

| O quê | Quando | Motivo |
|---|---|---|
| Banco (`backup-db.ps1`) | **Diário nos dias úteis**, ao fim do expediente, e **antes de qualquer migration, mudança de esquema ou deploy que mexa no banco** | Sem PITR, o pior caso é perder o dia. Leva poucos minutos com dois clientes. |
| Arquivos (`storage-backup`) | **Semanal** e após qualquer lote grande de uploads (o espelho é incremental: baixa só o novo) | Arquivos são imutáveis; o risco é perder o bucket, não alterar. |
| Cópia fora da máquina | A cada banco/semana, junto da rotina | Regra 3-2-1: 3 cópias, 2 mídias, 1 fora. |
| Retenção | 7 diários, 4 semanais e 6 mensais | Cobre erro humano descoberto tarde. Apague os antigos à mão. |
| Ensaio de restauração | Antes de liberar para clientes reais e **trimestralmente** | Backup nunca ensaiado não é backup. |
| `cleanup-storage-orphans.mjs` | Mensal, **depois** do backup de arquivos | Nunca limpar antes de ter cópia. |

Não há agendamento automático de propósito: ele exigiria guardar a senha do banco na máquina. Marque um lembrete diário no calendário. **Com clientes reais, avalie o plano Pro** (backups diários gerenciados com 7 dias de retenção, PITR opcional e proteção contra senhas vazadas; `docs/PRODUCAO.md` seção 1): ele complementa, não substitui, a cópia fora da máquina, e o Storage continua sem backup gerenciado.

## 9. Limites

- **RPO** (perda máxima) com a rotina diária: até 24 h, e o Free não tem PITR. **RTO** (tempo para voltar): algumas horas, dominado por migrations + restauração + reconfiguração.
- O dump é lógico e consistente por instantâneo, mas a contagem de referência é feita **antes** dele: se alguém gravar nesse intervalo, a diferença é esperada (rode fora do horário de uso).
- Recursos do Supabase fora do escopo (Vault/pgsodium, Edge Functions, webhooks, publicações Realtime) **não são usados** pelo app; se passarem a ser, revise este roteiro.
- Projetos Free podem ser **pausados por inatividade**; confira a política vigente no painel.
