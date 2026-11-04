#!/usr/bin/env bash
# Uso: scripts/safe-commit.sh "<título>" "<corpo>" caminho1 caminho2 ...
# Confere branch, .env.local ignorado, varredura de segredos no que será commitado e só então comita.
# Arquivos .env* são proibidos, EXCETO .env.example (modelo só com nomes de variáveis; valores preenchidos
# são recusados abaixo, com exceção do APP_URL local).
set -u
cd "$(git rev-parse --show-toplevel)" || exit 1
title="$1"; body="$2"; shift 2
[ "$(git branch --show-current)" = "fase-2" ] || { echo "ERRO: branch não é fase-2"; exit 1; }
git check-ignore -q .env.local || { echo "ERRO: .env.local não está ignorado"; exit 1; }
git add -- "$@" 2>&1 | grep -v "^warning"
if git diff --cached --name-only | grep -vxE "(.*/)?\.env\.example" | grep -E "(^|/)\.env|\.next|test-results|tsbuildinfo|next-env|node_modules" ; then echo "ERRO: arquivo proibido no stage"; git reset -q; exit 1; fi
if git diff --cached --name-only | grep -qxE "(.*/)?\.env\.example"; then
  if git show :.env.example | tr -d '\r' | grep -E "^[A-Za-z_]+=.+" | grep -vE "^APP_URL=http://localhost:3000$"; then
    echo "ERRO: .env.example com valor preenchido"; git reset -q; exit 1
  fi
fi
if git diff --cached 2>/dev/null | grep -E '^\+' | grep -iE 'sb_secret_[A-Za-z0-9_-]{10,}|sb_publishable_[A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9_-]{20,}|re_[A-Za-z0-9]{20,}|token_hash=[A-Za-z0-9]{10,}|BEGIN (RSA|PRIVATE)'; then echo "ERRO: padrão de segredo"; git reset -q; exit 1; fi
node -e '
const fs=require("fs");const {execSync}=require("child_process");
const env=fs.readFileSync(".env.local","utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")&&l.includes("="));
const diff=execSync("git diff --cached",{encoding:"utf8",maxBuffer:1e9});
let h=0;for(const l of env){const k=l.slice(0,l.indexOf("="));if(/^(APP_URL|NEXT_PUBLIC_APP_URL|APROVA_DEMO_MODE|EMAIL_PROVIDER)$/.test(k))continue;const v=l.slice(l.indexOf("=")+1).trim().replace(/^["\x27]|["\x27]$/g,"");if(v.length>=8&&diff.includes(v))h++}
if(h>0){console.log("ERRO: valor do .env.local no commit");process.exit(2)}' || { git reset -q; exit 1; }
printf '%s\n\n%s\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\n' "$title" "$body" | git commit -q -F - 2>&1 | grep -v "^warning"
echo "commit: $(git log -1 --format='%h %s')"
echo "pendentes: $(git status --short 2>/dev/null | wc -l)"
