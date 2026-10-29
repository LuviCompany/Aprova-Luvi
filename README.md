# Aprova Luvi

Plataforma de aprovação de materiais criativos da **Luvi Company**.

> **Fase 1 — protótipo com dados fictícios.** Sem backend, banco ou envio de e-mail. Veja `CLAUDE.md` para convenções, segurança e roteiro.

```bash
npm install
npm run dev        # http://localhost:3000
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
