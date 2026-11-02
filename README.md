# Aprova Luvi

Plataforma de aprovação de materiais criativos da **Luvi Company**.

> **Fase 2 em andamento (branch `fase-2`).** Banco (migrations + RLS) e autenticação (Supabase Auth) prontos e testados; as telas ainda leem dados fictícios. Sem `SUPABASE_URL`, use `APROVA_DEMO_MODE=true` para o modo demonstração. Configuração do Supabase em `docs/SUPABASE.md`; convenções e segurança em `CLAUDE.md`.

```bash
npm install
APROVA_DEMO_MODE=true npm run dev   # http://localhost:3000 (modo demonstração)
npm run check      # lint + tipos + testes unitários
npm run test:e2e   # Playwright (instale o navegador uma vez: npx playwright install chromium)
```

## Telas para explorar

| Rota | O que é |
|---|---|
| `/login` | Entrada (aba Equipe Luvi / Sou cliente). Demo: e-mail válido + senha de 6+ caracteres |
| `/admin` | Dashboard, com filtros e indicadores |
| `/admin/materiais/m1` | Revisão de material (comentários por slide, versões) |
| `/portal` | Portal do cliente (Casa Aurora Móveis) |
| `/aprovar/demo` | Aprovação rápida por link seguro. Código de demonstração: `123456` |
| `/aprovar/expirado` · `/revogado` · `/utilizado` | Estados de link inválido |
