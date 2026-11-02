# Configuração do Supabase — Aprova Luvi

Guia para ligar a Fase 2 a um projeto Supabase e **validar os Módulos 1 (banco) e 2 (autenticação)** com segurança, sem tocar na produção atual (a demonstração da Fase 1 em `aprova.luvicompany.com.br`).

> Nada neste guia foi executado contra um projeto real: tudo foi validado em testes locais (Postgres em memória + testes do app). A validação em nuvem é o que a seção 5 faz.

## 1. Decisão: o projeto existente é o ambiente de desenvolvimento e validação

| Ambiente | Projeto Supabase | Endereço do app | Quando |
|---|---|---|---|
| **Desenvolvimento / validação** | **DB Aprova Luvi** (organização Luvi Company), `https://kswnwootbdzlhdvbhhpk.supabase.co` | `http://localhost:3000` | **agora** |
| Produção | outro projeto, a criar | `https://aprova.luvicompany.com.br` | só depois dos Módulos 3 e 4 |

- O projeto **DB Aprova Luvi** ainda **não está conectado à produção** do Aprova Luvi. Ele serve só para desenvolvimento e validação, com dados e usuários de teste. **Não use dados de clientes reais nele.**
- **Não promova este projeto a produção** sem uma decisão separada: seria preciso apagar usuários e dados de teste, rotacionar todas as chaves e reconfigurar o Auth (Site URL, Redirect URLs, SMTP).
- Por que projetos separados: o Supabase tem **um único** "Site URL" por projeto e uma lista única de redirecionamentos. Com um projeto só, e-mails de convite e recuperação gerados em desenvolvimento poderiam apontar para a produção (ou o contrário), e vazar a chave de dev comprometeria a produção.
- A configuração inicial usa **somente** `http://localhost:3000`. O domínio de produção não entra neste projeto em nenhum campo.
- Como o projeto já existia, ele pode ter configurações que não são as padrão. Por isso a seção 5.2 (verificação) e o pré-voo vêm **antes** de qualquer migration.

## 2. Variáveis de ambiente (todas as que o código lê)

| Variável | Obrigatória | Visibilidade | Onde é lida |
|---|---|---|---|
| `SUPABASE_URL` | sim (fora da demo) | servidor | `src/lib/env.ts` |
| `SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`) | sim (fora da demo) | servidor | clientes `server.ts` e `proxy.ts` |
| `SUPABASE_SECRET_KEY` (`sb_secret_…`) | para convites, links e URLs assinadas (Módulos 3/4); o login não precisa | **SECRETA, só servidor** | `src/lib/supabase/admin.ts`, `scripts/bootstrap-admin.mjs` |
| `APP_URL` | em produção; em dev o padrão é `http://localhost:3000` | servidor | links dos e-mails de recuperação |
| `APROVA_DEMO_MODE` | não | servidor | modo demonstração (ignorado se o Supabase estiver configurado) |
| `NODE_ENV` | definida pelo Next/Vercel | — | decide as regras de `APP_URL` |

Nomes legados (`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`) ainda funcionam como reserva e geram aviso no `env:check`. `RESEND_API_KEY` aparece no `.env.example` mas **ainda não é lida pelo código** (Fase 3).

Valores para este projeto (o `.env.local` **nunca** é versionado):

```bash
SUPABASE_URL=https://kswnwootbdzlhdvbhhpk.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   # copie do painel
SUPABASE_SECRET_KEY=sb_secret_...             # copie do painel; só neste arquivo e no gerenciador de senhas
APP_URL=http://localhost:3000
```

Conferir a configuração sem abrir conexão e sem imprimir chaves:

```bash
npm run env:check
```

O app recusa subir com a chave trocada: se uma chave **secreta** for colocada em `SUPABASE_PUBLISHABLE_KEY`, o Supabase é tratado como não configurado e o `env:check` acusa o erro.

## 3. Chaves modernas (`sb_publishable_` / `sb_secret_`)

- **Publicável** (`sb_publishable_…`): equivale ao papel `anon` (e `authenticated` com usuário logado). Respeita a RLS. É a que o app usa em todo acesso em nome do usuário.
- **Secreta** (`sb_secret_…`): equivale ao `service_role` (ignora a RLS). Só em código de servidor, depois de autorizar a operação; nunca em `NEXT_PUBLIC_*`, commit, log, print ou chat. O Supabase bloqueia seu uso a partir de navegador, mas isso é só uma trava, não proteção.
- Não são JWT e vão no cabeçalho `apikey`. As bibliotecas instaladas (`@supabase/supabase-js` 2.118, `@supabase/ssr` 0.12) já reconhecem esses formatos.
- As chaves legadas (`anon`/`service_role`, em formato JWT) continuam válidas até você desativá-las, e o Supabase anunciou a descontinuação até o fim de 2026. **Não use as legadas.** Depois de validar tudo, desative-as em Settings > API Keys (aba "Legacy").
- **Chaves de assinatura de JWT:** em Settings > JWT Keys, confirme que a chave de assinatura em uso é **assimétrica** (ECC P-256). Assim `getClaims()` (usado no `proxy.ts`) valida o token localmente. Com o segredo legado HS256 ele cai numa chamada de rede por requisição.
- Use uma chave secreta **por componente** quando houver mais de um (ex.: uma para o app, outra para scripts), para poder rotacionar uma sem afetar a outra.
- **Ainda não validado em nuvem:** que `sb_secret_` funciona na API administrativa do Auth (`inviteUserByEmail`). O `--check-connection` (seção 5.6) testa isso com uma leitura inofensiva antes de qualquer envio.

## 4. Isolamento dev x produção: o que garante que um e-mail de dev não leva à produção

1. **Projeto separado** (seção 1): o link de convite/recuperação é emitido pelo projeto de dev.
2. **Modelo de e-mail usa `{{ .RedirectTo }}`**, não `{{ .SiteURL }}` (`supabase/templates/*.html`). O app informa o `redirectTo` do **próprio ambiente** (`APP_URL`), e o Supabase só aceita endereços da lista de Redirect URLs.
3. **Lista de Redirect URLs do projeto de dev contém só `localhost`.** Como o projeto já existia, **remova qualquer outra entrada preexistente**. Mesmo um erro de configuração não consegue gerar link para a produção.
4. **`APP_URL` em desenvolvimento só aceita localhost:** qualquer valor de fora (ex.: um `.env.local` copiado da produção) é ignorado e vira `http://localhost:3000`. Em produção, `APP_URL` precisa ser `https`; sem isso o app **não envia** o e-mail de recuperação.
5. **`supabase/config.toml` é só local** e nunca contém o domínio de produção.
6. **Vercel:** não cadastre as variáveis deste projeto em Production nem em Preview. Ver seção 6.

## 5. Ordem exata para conectar e validar

Legenda: **[Você]** age no painel/terminal; **[Eu]** executo, mediante sua autorização.

### 5.1 Preparação local (sem nuvem)
1. `npm run check` e `npm run test:db` verdes. Resultado esperado: tudo passa.

### 5.2 Verificar o projeto existente (ANTES de qualquer migration) — [Você]

**Por que isso é obrigatório:** a migration 3 revoga **todos** os privilégios de `anon` e `authenticated` em **todas** as tabelas do schema `public`. Num projeto compartilhado com outro aplicativo, isso o derrubaria.

2. **Confirmar que nenhuma aplicação usa este projeto.** Resultado do que já foi verificado em 2026-11-02 (somente leitura, sem decifrar nenhum segredo):

   | Onde | Resultado |
   |---|---|
   | Código da `main` (produção atual) | só comentários mencionam o Supabase; não lê nenhuma variável dele |
   | Código da `fase-2` | não contém o identificador deste projeto (`kswnwootbdzlhdvbhhpk`) |
   | Repositório Site-Luvi (commit `019134c`) | nenhuma menção a Supabase |
   | Vercel `aprova-luvi` | nenhuma variável de ambiente cadastrada |
   | Vercel `site-luvi` | só `RESEND_API_KEY`; nada de Supabase |
   | Vercel `site-ramal`, `streetcabsp` | nenhuma variável de ambiente |
   | Vercel **`system`** (em produção) | **usa algum projeto Supabase** (variáveis `SUPABASE_*` e `POSTGRES_*`, com valores cifrados). **Não foi possível saber qual** |

   **Ação obrigatória sua:** na Vercel, abra o projeto `system` > Settings > Environment Variables, revele `NEXT_PUBLIC_SUPABASE_URL` e confira que **NÃO é** `https://kswnwootbdzlhdvbhhpk.supabase.co`. Se for igual, **pare**: não aplique nenhuma migration e avise. No painel do Supabase deste projeto, confira também **Integrations** (nenhuma integração com a Vercel conectada) e **Logs > API Gateway** (sem tráfego nos últimos dias).
3. **Pré-voo: o banco está vazio?** No SQL Editor, execute `supabase/preflight.sql`. **Todos os blocos `CHECK` devem devolver 0 linhas.** Os blocos `INFO` são só para você olhar (extensões, gatilhos, privilégios padrão). Qualquer linha em um `CHECK` significa que o projeto já tem conteúdo: pare e traga o resultado. Confira ainda em Edge Functions e Database > Webhooks: ambos vazios.

### 5.3 Chaves — [Você]
4. Project Settings > API Keys: copiar a **publishable** e criar/copiar uma **secret** (guarde a secret só no gerenciador de senhas e no `.env.local`).
5. Project Settings > JWT Keys: confirmar chave de assinatura assimétrica ativa.

### 5.4 Configurar o Auth do projeto — [Você]
6. Authentication > Sign In / Providers > Email: manter ligado; **desligar** "Allow new users to sign up" (o padrão de projetos novos é ligado).
7. Authentication > URL Configuration: `Site URL` = `http://localhost:3000`; **Redirect URLs** = somente `http://localhost:3000/auth/confirm` (remova qualquer outra entrada).
8. Authentication > Email Templates: colar `supabase/templates/recovery.html` (Reset Password) e `supabase/templates/invite.html` (Invite user).
9. E-mail: o SMTP padrão do Supabase **só envia para endereços da equipe da organização** (outros falham com "Email address not authorized"), **no máximo 2 e-mails por hora**, e não é para produção. Para a validação isso basta: teste só com o seu e-mail (membro da organização) e não repita envios em sequência. Para uso real, configure SMTP próprio (Resend) no projeto de produção.
10. Política de senha do Auth (Sign In / Providers > Email): comprimento mínimo **10** e exigir **letras e números**, igual à regra do app (`src/lib/auth/password.ts`). Assim a regra vale mesmo se alguém usar a API do Auth diretamente.
11. Opcional: proteção contra senhas vazadas (exige plano Pro) e desligar a extensão `pg_graphql` (Database > Extensions), já que o app não usa GraphQL.

### 5.5 Variáveis locais — [Você]
12. Criar `.env.local` (não versionado) com os valores da seção 2.
13. `npm run env:check` → deve terminar com "Configuração válida" e **sem** avisos de chave legada.

### 5.6 Validar a conexão (ainda SEM migrations) — [Você]
14. Simulação, sem rede: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/bootstrap-admin.mjs --email SEU@EMAIL --name "Seu Nome"`, com `SUPABASE_URL`, `SUPABASE_SECRET_KEY` e `APP_URL` no ambiente do terminal.
15. `--check-connection` **só roda depois das migrations**: ele consulta `public.profiles`, que ainda não existe. Antes delas, valide a conexão e as chaves por `npm run dev` + a tela `/login` (deve abrir sem o aviso de "ambiente não configurado") e um login com e-mail inexistente (deve responder "E-mail ou senha incorretos.", provando que o app alcança o Auth).

### 5.7 Aplicar as migrations — [Você] (ou [Eu], se autorizado e com acesso)
16. SQL Editor do projeto: executar **uma vez e na ordem**, um arquivo por vez, parando se der erro:
    `20261102120000_core_schema.sql` → `20261102120100_functions.sql` → `20261102120200_rls_policies.sql` → `20261102120300_storage.sql`.
    (Alternativa: `supabase link --project-ref kswnwootbdzlhdvbhhpk` e `supabase db push --dry-run`, depois `supabase db push`.)
    Se a migration 4 falhar por permissão em `storage.objects`, aplique as 4 políticas pelo painel Storage > Policies com o mesmo SQL.
17. Executar `supabase/verify.sql`. **Todos os blocos devem devolver 0 linhas.** Qualquer linha é uma violação a resolver antes de seguir.
18. Storage: confirmar que o bucket `materials` existe e está **privado**.

### 5.8 Primeiro administrador — [Você]
19. Teste de conexão somente leitura: o comando do passo 14 com `--check-connection`. Prova que a chave `sb_secret_` funciona na API de dados e na API administrativa do Auth. **Não cria nada.**
20. Execução real (envia o convite): o mesmo comando com `--execute --project-host kswnwootbdzlhdvbhhpk.supabase.co`. O script se recusa a rodar em banco com perfis, com chave pública, com `APP_URL` de produção ou com host diferente do informado.

### 5.9 Validar o app contra o projeto real — [Você] e [Eu]
21. `npm run dev` (sem `APROVA_DEMO_MODE`). Abra o e-mail do convite: o endereço do link **deve começar com `http://localhost:3000/auth/confirm`**. Se apontar para outro domínio, pare e revise o passo 7.
22. Criar a senha em `/redefinir-senha`; cair em `/login` com "Senha alterada"; entrar. Esperado: `/admin` com o aviso amarelo de dados de demonstração.
23. Conferir: `/portal` redireciona o administrador para `/admin`; "Sair" volta ao login; `/admin` sem sessão vai ao login com `?next=`.
24. "Esqueci minha senha": o e-mail chega, o link aponta para `localhost`, a nova senha funciona e a sessão antiga é encerrada.
25. Conferir no painel (Authentication > Users) que existe **só** o administrador e que ninguém consegue se cadastrar sozinho.

### 5.10 Só depois
26. Registrar o resultado (hash do commit, data, o que passou/falhou) e decidir o Módulo 3. **Não** configurar a produção, o domínio nem variáveis da Vercel nesta etapa.

## 6. Vercel e a produção atual

- A produção atual roda a Fase 1 (branch `main`) em modo demonstração e **não lê nenhuma variável do Supabase**. O projeto Vercel `aprova-luvi` não tem nenhuma variável de ambiente cadastrada. Cadastrar variáveis lá não a altera enquanto o código implantado for o da `main`, mas **não cadastre as deste projeto de desenvolvimento**.
- O projeto Vercel **`system`** (outro aplicativo em produção da equipe) já usa um Supabase. Nunca copie as variáveis dele para o Aprova Luvi nem o contrário, e confirme na seção 5.2 que ele não aponta para este projeto.
- A branch `fase-2` **não deve ser implantada** (nem como Preview) antes da hora: sem `APROVA_DEMO_MODE=true` e sem Supabase, ela falha fechado e a demonstração some.
- Quando for a hora de publicar a Fase 2: projeto Supabase **de produção** novo, variáveis só no escopo **Production** (marcadas como Sensitive), `APP_URL=https://aprova.luvicompany.com.br`, Site URL e Redirect URLs com o domínio de produção **no projeto de produção**, e remover `APROVA_DEMO_MODE`.

## 7. Cuidados e riscos conhecidos

- O painel e o portal **ainda leem dados fictícios** (`src/lib/mock`) até os Módulos 3 e 4: autenticação e RLS são reais, **mas não cadastre clientes reais**. Há um aviso amarelo nas telas. `/aprovar/[token]` fica fechado ("link inválido") fora do modo demonstração.
- Migrations: aplicar uma vez, na ordem. **Nunca editar uma migration já aplicada**: crie uma nova. Toda função nova precisa de `revoke execute … from public, anon` (o Postgres abre EXECUTE a PUBLIC por padrão); `npm run test:db` reprova se faltar.
- Usuários não são excluídos, são **desativados** (`profiles.active = false`): histórico, decisões e auditoria referenciam o perfil.
- O e-mail do perfil (`profiles.email`) é uma cópia do e-mail do Auth. Se o e-mail mudar no Auth, o perfil não acompanha sozinho (o app não oferece troca de e-mail).
- Comentários da equipe em versões já enviadas são **visíveis ao cliente** (não existe nota interna). Decisão consciente até haver necessidade.
- Validação do conteúdo real dos uploads (assinatura do arquivo, não só o tipo declarado) e a geração de URLs assinadas são do Módulo 3.
- Limite de 50 MB por arquivo = teto do plano gratuito do Storage.
- O projeto existente pode ter sido criado com configurações diferentes das de um projeto novo (cadastro livre ligado, Redirect URLs antigas, extensões extras): a seção 5.2 e o `preflight.sql` existem para pegar isso antes de qualquer alteração.
