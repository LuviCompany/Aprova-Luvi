# Validação da Fase 2 — Aprova Luvi

Registro do que foi validado contra o projeto Supabase de **desenvolvimento** (**DB Aprova Luvi**, `kswnwootbdzlhdvbhhpk`) em **2026-11-02**. Escopo: Módulo 1 (banco) e Módulo 2 (autenticação). Os Módulos 3 (materiais) e 4 (aprovação) **não foram iniciados**.

Legenda de quem executou cada teste: **[Usuário]** = teste manual feito pelo próprio usuário no navegador; **[Claude]** = executado pelo assistente (scripts, painel do Supabase, testes automatizados).

## 1. Resumo

| Área | Resultado |
|---|---|
| Banco: pré-voo, 4 migrations, `verify.sql` | Aprovado (16 blocos com 0 linhas) |
| Primeiro administrador e senha | Concluído |
| Login, `/admin`, `/portal`, menu, logout, rota protegida | Aprovado (testes manuais do usuário) |
| Lint, tipos e testes (unitários, banco, componentes) | Aprovado: 288 testes em 19 arquivos |
| Build de produção e E2E (Playwright) | Aprovado: 18 rotas; 47 de 47 |
| Recuperação de senha por e-mail | **Não testada** (depende de SMTP próprio: `docs/EMAIL-RESEND.md`) |

Nada foi publicado: sem push, merge ou deploy; `main` e a produção atual ficaram intocadas (`main` = `origin/main` = `7976061`).

## 2. Banco de dados (Módulo 1) — [Claude], com autorização expressa do usuário

1. **Condições prévias confirmadas:** o ID do projeto bate com o `.env.local`; o banco estava vazio (API: nenhuma tabela exposta, 0 buckets, 0 usuários); nenhum projeto da Vercel usa este Supabase (o projeto `system` usa `iiwqkfqqmhhtbjobxzkh`); as quatro migrations estavam revisadas e `npm run test:db` verde.
2. **Pré-voo** (`supabase/preflight.sql`, bloco SUMMARY, no SQL Editor): 7 verificações com 0.
3. **Migrations**, aplicadas no SQL Editor uma por vez, na ordem, cada uma conferida no catálogo antes da seguinte. Antes de executar, o SHA-256 do texto colado no editor foi comparado com o do arquivo do repositório.

| Migration | SHA-256 (início) | Conferência após aplicar |
|---|---|---|
| `20261102120000_core_schema` | `9c7fb397…` | 15 tabelas, 9 tipos, 9 funções em `app`, 18 triggers, 0 privilégios para `anon`/`authenticated` |
| `20261102120100_functions` | `ab69bc3f…` | 22 funções em `app`, 5 RPCs em `public`, nenhuma executável por `anon`, `decide_via_link` só para `service_role` |
| `20261102120200_rls_policies` | `7d2ef2f3…` | RLS em 15 de 15 tabelas, 39 políticas, só as 2 tabelas de segredos sem política |
| `20261102120300_storage` | `19be3c1d…` | bucket `materials` privado (50 MB, 6 tipos MIME) e 4 políticas em `storage.objects` |

   - O painel avisou "Potential issue detected: creates tables without enabling Row Level Security" na migration 1. Por decisão do usuário, foi escolhido **"Run without RLS"** (executa o texto revisado; a RLS é ligada na migration 3 e, no intervalo, `anon`/`authenticated` não têm privilégio algum nas tabelas).
4. **`supabase/verify.sql`** (hash `acadd8f7…`): **16 blocos CHECK, todos com 0 linhas.** Como o SQL Editor só mostra o último resultado de um arquivo, cada bloco foi executado dentro de um `count(*)`, com o texto exato do arquivo, para ver os 16 numa tabela.
5. **Inventário final:** 15 tabelas, 39 políticas em `public` + 4 em `storage.objects`, 1 bucket privado, 0 usuários no Auth antes do bootstrap.

## 3. Primeiro administrador — [Claude] a pedido do usuário

- `scripts/bootstrap-admin.mjs`: simulação, `--check-connection` ("Conexão OK. Perfis existentes: 0") e execução real em `--project-host kswnwootbdzlhdvbhhpk.supabase.co`.
- A execução real foi disparada no painel de Terminal do usuário, para o link de convite (que vale como senha) aparecer só ali. O link **não** foi colado em chat nem salvo em arquivo.
- Ocorrências: a 1ª tentativa abriu o terminal na pasta errada e não criou nada; a 2ª falhou com `fetch failed` (rede, ver `docs/DIAGNOSTICO-REDE.md`) depois de criar a organização; a 3ª concluiu (o script reaproveita a organização existente).
- Estado final (API): 1 organização "Luvi Company", 1 perfil `Admin` (`admin@luvicompany.com.br`, papel `admin`, ativo), 1 usuário no Auth, cadastro livre desligado (`disable_signup: true`).

## 4. Autenticação (Módulo 2) — testes manuais

| # | Teste | Quem | Resultado |
|---|---|---|---|
| 1 | Convite (`/auth/invite`) → definir senha em `/redefinir-senha` → login | [Usuário] | **Aprovado** (após a correção da seção 5) |
| 2 | `/admin` abre com o administrador autenticado (dashboard com aviso amarelo de dados de demonstração) | [Usuário], e conferido pelo [Claude] no Chrome (página carregou e hidratou, console sem erros) | **Aprovado** |
| 3 | `/portal` redireciona o administrador autenticado para `/admin` | **[Usuário]** | **Aprovado** |
| 4 | Menu do administrador abre com e-mail, papel e "Sair", sem o erro `MenuGroupContext is missing` | **[Usuário]** | **Aprovado** |
| 5 | "Sair" encerra a sessão e volta ao login; depois, `/admin` redireciona para `/login?next=%2Fadmin` | **[Usuário]** | **Aprovado** |
| 6 | `/admin`, `/admin/materiais`, `/portal`, `/redefinir-senha` sem sessão → 307 para `/login?next=…`, sem vazar conteúdo | [Claude] (curl no servidor de desenvolvimento) | **Aprovado** |

Os testes 3, 4 e 5 foram **realizados manualmente pelo usuário** em 2026-11-02; o assistente não conseguiu automatizá-los porque a extensão do Chrome falhou ao injetar scripts (três tentativas).

## 5. Defeitos encontrados na validação e corrigidos

| Sintoma | Causa | Correção (commit) |
|---|---|---|
| "Este link expirou ou já foi usado" ao salvar a nova senha, com o convite válido | Timeout de conexão com o Supabase em `getUser()` era tratado como "sem sessão" | `getSessionState` ganhou o estado `unavailable`; login e redefinição mostram "serviço de autenticação" e não encerram a sessão (`85821a7`) |
| Erro `Base UI: MenuGroupContext is missing` ao abrir o menu do usuário ("1 Issue") | `DropdownMenuLabel` fora de `DropdownMenuGroup` em `admin-shell` e `portal-shell` | Rótulo dentro do grupo; teste `user-menu.test.tsx` abre os dois menus (`83ea1b5`) |
| `Date.now()` instável no prerender de `/redefinir-senha` e `/login` | `requireAnyUser`/`LoginContent` liam a sessão sem `connection()` | `await connection()` (`85821a7`, `fe9ae14`) |
| Timeouts intermitentes de conexão | **Rede local**, não o Supabase (destinos de controle também perdem pacotes) | Diagnóstico e `npm run net:check` (`docs/DIAGNOSTICO-REDE.md`) |

**Defeito também presente na `main` (produção da Fase 1):** o mesmo `DropdownMenuLabel` fora de grupo existe na demonstração publicada. Não foi alterado (a produção está fora do escopo e exige deploy autorizado). Ver o item no checklist de lançamento.

## 6. Testes automatizados — [Claude]

- `npm run lint`, `tsc --noEmit`: sem erros.
- `vitest`: **288 testes em 19 arquivos**, incluindo 128 de banco (PGlite: esquema, RLS, isolamento, aprovação, privilégios, `verify.sql`, pré-voo).
- Build de produção em diretório isolado (`NEXT_DIST_DIR=.next-e2e`, sem interferir no `next dev`): 18 rotas, sem avisos.
- E2E (Playwright, portas 3100 e 3101): **47 de 47**. Uma execução anterior deu 46 de 47 por um timeout de 5 s no login do portal, com o E2E competindo por CPU com o build e o Chrome; o teste passou 3 de 3 isolado e a repetição limpa passou tudo.
- `npm audit --omit=dev`: 6 achados (2 baixos, 4 moderados), todos na cadeia da CLI `shadcn` (`ts-morph`/`minimatch`/`deepmerge`); nenhum em código de execução do app. Ver o checklist.

## 7. Ainda não validado

- **Recuperação de senha por e-mail** e e-mails de convite pelo Supabase: dependem de SMTP próprio. Passo a passo em `docs/EMAIL-RESEND.md`.
- Configurações do Auth feitas no painel e **não verificadas pelo assistente**: Site URL, lista de Redirect URLs, política de senha (10+ caracteres, letras e números). Só o cadastro livre desligado foi confirmado pela API.
- Módulos 3 e 4 (materiais reais, aprovação, link seguro com código): não iniciados; `/admin` e `/portal` ainda leem `src/lib/mock` e mostram o aviso amarelo.

## 8. Histórico de commits da validação (branch `fase-2`)

`b9532ad` conexão validada, E2E hermético · `85821a7` falha de rede ≠ sem sessão · `83ea1b5` correção do menu · `fe9ae14` `Date.now` no login e build/E2E isolados. Os commits desta documentação vêm depois (ver `git log`).

## 9. Módulo 3, etapa A.2: migrations aplicadas no projeto de desenvolvimento (2026-11-03)

As migrations `20261103120000` a `20261103120300` (integridade de clientes e projetos, aprovador em vários clientes, convites preparados e auditoria) foram aplicadas no DB Aprova Luvi, uma por vez, com conferência do SHA-256 do texto e verificação no catálogo depois de cada uma. O `verify.sql` atualizado (22 blocos) devolveu **0 em todos**; o bucket `materials` segue privado; a conta administrativa está íntegra; nenhum dado foi criado. Registro completo, hashes, a ocorrência de colagem na M2 e o teste manual com dados fictícios (aprovado em 2026-11-03, 11 de 11) em `docs/MIGRACOES-A2.md`, seção 6, e `docs/MODULO-3.md`, seção 11.

