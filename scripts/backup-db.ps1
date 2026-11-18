<#
  Backup lógico do banco de PRODUÇÃO do Aprova Luvi. SOMENTE LEITURA no Supabase (pg_dump e SELECTs).
  Procedimento completo, restauração e ensaio: docs/BACKUP.md

  Uso (PowerShell, na raiz do repositório):
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup-db.ps1 -Dest D:\Backups\AprovaLuvi -DbHost <host do Session pooler>

  Pede, de forma oculta: a senha do banco e a senha do backup. Nada disso é impresso nem gravado.
  Resultado: <Dest>\aprova-luvi-db-<data>.tar.sealed (+ .sha256). Os arquivos em texto claro são apagados no fim.
  Requer: pg_dump e psql (PostgreSQL client tools), node, tar e git no PATH.
#>
param(
  [Parameter(Mandatory = $true)][string]$Dest,
  [Parameter(Mandatory = $true)][string]$DbHost,
  [string]$ProjectRef = "nvtiynmebffxctqlrwqo",
  [int]$Port = 5432
)
$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$destFull = [IO.Path]::GetFullPath($Dest)
if ($destFull.StartsWith($repo, [StringComparison]::OrdinalIgnoreCase)) { throw "Dest não pode ficar dentro do repositório (backup nunca é versionado)." }
if ($destFull -match 'OneDrive|Dropbox|Google ?Drive|iCloud') { throw "Dest está numa pasta sincronizada com a nuvem. Use uma pasta local em disco cifrado." }
foreach ($tool in "pg_dump", "psql", "node", "tar", "git") {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Ferramenta ausente no PATH: $tool (veja docs/BACKUP.md, seção 3)." }
}

function Read-Secret($nome) { $s = Read-Host $nome -AsSecureString; [Net.NetworkCredential]::new("", $s).Password }
function Invoke-Tool($exe, [string[]]$toolArgs) {
  & $exe @toolArgs
  if ($LASTEXITCODE -ne 0) { throw "$exe falhou (código $LASTEXITCODE)." }
}

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd'T'HHmmss'Z'")
$work = Join-Path $destFull "tmp-$stamp"
$tar = Join-Path $destFull "aprova-luvi-db-$stamp.tar"
$sealed = "$tar.sealed"
$backupTools = Join-Path $repo "scripts\backup-tools.mjs"
$node = @("--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", $backupTools)

try {
  $env:PGPASSWORD = Read-Secret "Senha do banco de PRODUCAO (Supabase)"
  $env:PGSSLMODE = "require"
  if (-not $env:BACKUP_PASSPHRASE) {
    $p1 = Read-Secret "Senha do BACKUP (16+ caracteres; guarde no gerenciador de senhas)"
    $p2 = Read-Secret "Repita a senha do backup"
    if ($p1 -ne $p2) { throw "As senhas do backup não conferem." }
    $env:BACKUP_PASSPHRASE = $p1
  }
  New-Item -ItemType Directory -Path $work -Force | Out-Null
  $conn = @("--host=$DbHost", "--port=$Port", "--username=postgres.$ProjectRef", "--dbname=postgres", "--no-password")

  # 1) contagem de linhas por tabela (referência para conferir a restauração)
  $sql = Get-Content (Join-Path $repo "scriptsackup-contagens.sql") -Raw
  $sql | & psql @conn -X -At -F ";" -v ON_ERROR_STOP=1 -f - | Set-Content (Join-Path $work "contagens.csv") -Encoding ascii
  if ($LASTEXITCODE -ne 0) { throw "psql falhou (código $LASTEXITCODE) ao contar as linhas." }
  $tabelas = @(Get-Content (Join-Path $work "contagens.csv")).Count
  if ($tabelas -lt 10) { throw "Só $tabelas tabelas encontradas: projeto/usuário errado? Backup interrompido." }

  # 2) estrutura (tabelas, funções, políticas, privilégios) e dados
  Invoke-Tool pg_dump ($conn + @("--schema-only", "--no-owner", "--schema=public", "--schema=app", "--schema=auth", "--schema=storage", "--file=$(Join-Path $work 'estrutura.sql')"))
  Invoke-Tool pg_dump ($conn + @("--format=plain", "--data-only", "--no-owner", "--encoding=UTF8", "--table=public.*", "--table=app.*", "--table=auth.users", "--table=auth.identities", "--table=storage.buckets", "--file=$(Join-Path $work 'dados.sql')"))

  # 3) conferência do arquivo de dados e inventário (sem segredos)
  $dadosSql = Join-Path $work "dados.sql"
  if (-not ((Get-Content $dadosSql -Tail 5) -match "PostgreSQL database dump complete")) { throw "dados.sql está incompleto (sem a linha final do pg_dump)." }
  $dataEntries = @(Select-String -Path $dadosSql -Pattern "^COPY " ).Count
  if ($dataEntries -ne $tabelas) { Write-Warning "O dump tem $dataEntries blocos de dados e a contagem tem $tabelas tabelas. Confira antes de confiar neste backup." }
  $inv = @(
    "Backup lógico do Aprova Luvi (produção)",
    "UTC: $stamp",
    "Projeto: $ProjectRef",
    "Commit do código no repositório local: $(git -C $repo rev-parse HEAD)",
    "SHA-256 do sql-manifest: $((Get-FileHash (Join-Path $repo 'supabase\sql-manifest.sha256') -Algorithm SHA256).Hash.ToLower())",
    "Servidor: " + ((& psql @conn -X -At -c "select version()") -join " "),
    "Extensões: " + ((& psql @conn -X -At -F "=" -c "select extname, extversion from pg_extension order by 1") -join ", "),
    "Blocos de dados no dump: $dataEntries"
  )
  $inv | Set-Content (Join-Path $work "inventario.txt") -Encoding utf8
  Copy-Item (Join-Path $repo "supabase\sql-manifest.sha256") $work
  Copy-Item (Join-Path $repo "supabase\templates") (Join-Path $work "templates") -Recurse

  # 4) empacota, cifra, confere a integridade e só então apaga o texto claro
  Invoke-Tool tar @("-cf", $tar, "-C", $work, ".")
  Invoke-Tool node ($node + @("seal", "--in", $tar, "--out", $sealed))
  Invoke-Tool node ($node + @("unseal", "--in", $sealed, "--check"))
  $hash = (Get-FileHash $sealed -Algorithm SHA256).Hash.ToLower()
  "$hash  $(Split-Path $sealed -Leaf)" | Set-Content "$sealed.sha256" -Encoding ascii
  Write-Host ""
  Write-Host "Backup concluído: $sealed"
  Write-Host "SHA-256: $hash"
  Write-Host ("Tamanho: {0:N0} bytes; tabelas: {1}" -f (Get-Item $sealed).Length, $tabelas)
}
finally {
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $tar -Force -ErrorAction SilentlyContinue
  Remove-Item Env:PGPASSWORD, Env:PGSSLMODE, Env:BACKUP_PASSPHRASE -ErrorAction SilentlyContinue
}
