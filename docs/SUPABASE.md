# Configuração do Supabase — Aprova Luvi

Guia para ligar a Fase 2 a um projeto Supabase e **validar os Módulos 1 (banco) e 2 (autenticação)** com segurança, sem tocar na produção atual (a demonstração da Fase 1 em `aprova.luvicompany.com.br`).

> **Estado (2026-11-02):** a seção 5 foi executada no projeto de desenvolvimento **DB Aprova Luvi**: pré-voo, 4 migrations e `verify.sql` (16 blocos, todos com 0 linhas) aplicados e conferidos, primeiro administrador criado, login e rotas validados. O registro completo está em [`VALIDACAO-FASE-2.md`](VALIDACAO-FASE-2.md). **Não** há projeto de produção ainda. Documentos relacionados: [`EMAIL-RESEND.md`](EMAIL-RESEND.md) (recuperação de senha e SMTP), [`DIAGNOSTICO-REDE.md`](DIAGNOSTICO-REDE.md) (timeouts de conexão) e [`CHECKLIST-LANCAMENTO.md`](CHECKLIST-LANCAMENTO.md).
>
> Os passos abaixo continuam valendo como receita para **reproduzir** a configuração (por exemplo, no projeto de produção, com os ajustes da seção 6).

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
2. **O app informa o `redirectTo` do próprio ambiente** (`APP_URL/auth/recovery`, `APP_URL/auth/invite`) e o Supabase só aceita endereços da lista de Redirect URLs. O modelo de e-mail do projeto (`supabase/templates/*.html`, opcional) usa `{{ .RedirectTo }}` e nunca `{{ .SiteURL }}`; o modelo padrão do Supabase também devolve o usuário ao `redirectTo`. Nos dois casos o link leva ao endereço do ambiente que o pediu.
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
   | Vercel **`system`** (em produção) | usa o projeto `iiwqkfqqmhhtbjobxzkh.supabase.co`, **diferente** deste (`kswnwootbdzlhdvbhhpk`). Conferido manualmente pelo responsável em 2026-11-02 (as variáveis são cifradas, então só o painel da Vercel mostra o valor) |

   Conferido também no painel do Supabase deste projeto, em 2026-11-02:

   | Onde | Resultado |
   |---|---|
   | Integrations | só 2 instaladas, **Data API** e **Vault** (ambas nativas de todo projeto); nenhuma integração de terceiros, nem da Vercel |
   | Logs > API Gateway (últimos 60 min) | 22 eventos, **todos** de `@supabase-infra/mgmt-api` (verificações de saúde do próprio painel: `/auth/v1/health`, `/rest-admin/v1/ready`, `/admin/v1/service/versions`, `/admin/v1/network-bans/retrieve`). **PostgREST = 0, Auth = 0, Edge Function = 0**: nenhum aplicativo consultou o projeto |
   | Pré-voo (`SUMMARY`) | **7 linhas, todas com `violacoes = 0`**: sem objetos em `public`/`app`, sem usuários no Auth, sem buckets nem arquivos, sem políticas em `storage.objects`, nada no Realtime |

   Observação: o rótulo **"main · PRODUCTION"** na barra superior do painel do Supabase é só o nome da *branch principal* do projeto (todo projeto tem uma); **não** significa que o projeto esteja ligado a uma produção. O Free guarda logs por pouco tempo, então a janela de 60 min é uma amostra, mas combinada com o banco vazio é evidência suficiente. Se o `system` voltar a ser apontado para este projeto algum dia, a migration 3 não pode ser aplicada.
3. **Pré-voo: o banco está vazio?** O SQL Editor mostra só o resultado da **última** consulta quando se executa um arquivo inteiro, então **não cole o arquivo todo**. Faça assim:
   1. Em `supabase/preflight.sql`, copie **apenas o bloco `SUMMARY`** (da linha `select verificacao, violacoes` até `order by ordem;`), cole no SQL Editor e clique em Run.
   2. Resultado esperado: uma tabela de **7 linhas com `violacoes = 0` em todas**.
   3. Se alguma linha for maior que 0: pare, rode só o bloco `CHECK` correspondente para ver o que existe e traga o resultado. Não aplique as migrations.
   4. Os blocos `INFO` são só para olhar (um por vez). O de privilégios padrão mostra **o schema** de cada padrão do Supabase; é normal ver `anon`/`authenticated` neles (a migration 1 revoga isso para objetos futuros).
   5. Confira ainda em Edge Functions e Database > Webhooks: ambos vazios.

### 5.3 Chaves — [Você]
4. Project Settings > API Keys: copiar a **publishable** e criar/copiar uma **secret** (guarde a secret só no gerenciador de senhas e no `.env.local`).
5. Project Settings > JWT Keys: confirmar chave de assinatura assimétrica ativa.

### 5.4 Configurar o Auth do projeto — [Você]
6. Authentication > Sign In / Providers > Email: manter ligado; **desligar** "Allow new users to sign up" (o padrão de projetos novos é ligado).
7. Authentication > URL Configuration: `Site URL` = `http://localhost:3000`; **Redirect URLs** = somente `http://localhost:3000/auth/*` (o `*` cobre `/auth/recovery`, `/auth/invite` e `/auth/confirm`, mas não sai de `/auth/`). Remova qualquer outra entrada.
8. Authentication > Email Templates: **opcional nesta etapa**. O painel só deixa editar os modelos depois de configurar um SMTP próprio, e **o app não depende disso**: com os modelos padrão do Supabase (em inglês, sem a identidade da Luvi) o link do e-mail devolve o usuário a `/auth/recovery` ou `/auth/invite` com `?code=`, e o app conclui a troca de senha. Com SMTP próprio, cole `supabase/templates/recovery.html` (Reset Password) e `supabase/templates/invite.html` (Invite user) para ter e-mails em português e com a identidade Luvi. Detalhes na seção 5.4.1.
9. E-mail: o SMTP padrão do Supabase **só envia para endereços da equipe da organização** (outros falham com "Email address not authorized"), **no máximo 2 e-mails por hora**, e não é para produção. Para a validação isso basta: teste só com o seu e-mail (membro da organização) e não repita envios em sequência. Para uso real, configure SMTP próprio (Resend) no projeto de produção.
10. Política de senha do Auth (Sign In / Providers > Email): comprimento mínimo **10** e exigir **letras e números**, igual à regra do app (`src/lib/auth/password.ts`). Assim a regra vale mesmo se alguém usar a API do Auth diretamente.
11. Opcional: proteção contra senhas vazadas (exige plano Pro) e desligar a extensão `pg_graphql` (Database > Extensions), já que o app não usa GraphQL.

### 5.4.1 E-mails: modelos e SMTP (opcional agora, necessário depois)

- **Agora, sem SMTP próprio:** tudo funciona com o SMTP e os modelos padrão do Supabase, dentro dos limites do passo 9 (só destinatários da equipe, 2 por hora). Detalhe do **modelo padrão**: o link de recuperação usa o fluxo PKCE, então **abra o e-mail no mesmo navegador em que pediu a recuperação**; em outro aparelho o link falha com "link inválido" e basta pedir de novo.
- **Quando precisar de e-mails em português, para destinatários que não são da equipe ou em volume:** configure um SMTP próprio em Authentication > Emails > SMTP Settings. Com o Resend: host `smtp.resend.com`, porta `465`, usuário `resend`, senha = **uma chave de API nova criada só para o Supabase** (nunca reutilize a chave do site, que fica na Vercel), e remetente obrigatório (e-mail e nome). A documentação do Resend lista "domínio verificado" como pré-requisito; confirme lá se o seu remetente precisa de domínio verificado. Depois disso o painel libera a edição dos modelos.
- A chave do Resend entra **só** no painel do Supabase (e depois no Resend/Vercel da Fase 3). Nunca no chat, no repositório ou no `.env.local` deste projeto.

### 5.5 Variáveis locais — [Você]
12. Criar `.env.local` (não versionado) com os valores da seção 2.
13. `npm run env:check` → deve terminar com "Configuração válida" e **sem** avisos de chave legada.

### 5.6 Validar a conexão (ainda SEM migrations) — [Você]
14. Simulação, sem rede: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --env-file=.env.local scripts/bootstrap-admin.mjs --email SEU@EMAIL --name "Seu Nome"`. As variáveis (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `APP_URL`) vêm do `.env.local` por `--env-file`, então a chave secreta nunca precisa ser digitada no terminal.
15. `--check-connection` **só roda depois das migrations**: ele consulta `public.profiles`, que ainda não existe. Antes delas, valide a conexão e as chaves por `npm run dev` + a tela `/login` (deve abrir sem o aviso de "ambiente não configurado") e um login com e-mail inexistente (deve responder "E-mail ou senha incorretos.", provando que o app alcança o Auth).

### 5.7 Aplicar as migrations — [Você] (ou [Eu], se autorizado e com acesso)
16. SQL Editor do projeto: executar **uma vez e na ordem**, um arquivo por vez, parando se der erro:
    `20261102120000_core_schema.sql` → `20261102120100_functions.sql` → `20261102120200_rls_policies.sql` → `20261102120300_storage.sql`.
    (Alternativa: `supabase link --project-ref kswnwootbdzlhdvbhhpk` e `supabase db push --dry-run`, depois `supabase db push`.)
    Se a migration 4 falhar por permissão em `storage.objects`, aplique as 4 políticas pelo painel Storage > Policies com o mesmo SQL.
    O SQL Editor mostra um aviso "Potential issue detected: creates tables without enabling Row Level Security" ao executar a migration 1. Escolha **"Run without RLS"**: executa exatamente o arquivo revisado (a RLS é ligada na migration 3 e, antes disso, `anon`/`authenticated` não têm privilégio algum nas tabelas, porque a própria migration 1 revoga os padrões). "Run and enable RLS" faria o painel acrescentar comandos ao SQL.
    Para conferir que o texto colado é o do repositório, compare o SHA-256 do editor com o do arquivo (`docs/VALIDACAO-FASE-2.md` lista os usados em 2026-11-02).
17. Executar `supabase/verify.sql`. **Todos os blocos devem devolver 0 linhas.** Qualquer linha é uma violação a resolver antes de seguir. O arquivo tem **16 blocos `CHECK`**; como o SQL Editor mostra só o último resultado de um arquivo, rode cada bloco separadamente ou embrulhe cada um em `select count(*) from (…)`, como na validação de 2026-11-02.
18. Storage: confirmar que o bucket `materials` existe e está **privado**.

### 5.8 Primeiro administrador — [Você]
19. Teste de conexão somente leitura: o comando do passo 14 com `--check-connection`. Prova que a chave `sb_secret_` funciona na API de dados e na API administrativa do Auth. **Não cria nada.**
20. Execução real: o mesmo comando com `--execute --project-host kswnwootbdzlhdvbhhpk.supabase.co`. Cria a organização e o administrador e **imprime no terminal o link de convite** (de uso único, expira, vale como senha). **Nenhum e-mail é enviado**, então não precisa de SMTP. Com SMTP configurado, `--send-email` envia o convite por e-mail. O script se recusa a rodar em banco com perfis, com chave pública, com `APP_URL` de produção ou com host diferente do informado.

### 5.9 Validar o app contra o projeto real — [Você] e [Eu]
21. `npm run dev` (sem `APROVA_DEMO_MODE`). Abra o link de convite impresso pelo script: ele **deve começar com `http://localhost:3000/auth/invite`**. Para os e-mails de recuperação (passo 24), o botão do e-mail deve levar a `localhost:3000` (ou ao endereço do Supabase que redireciona para lá). Se apontar para outro domínio, pare e revise o passo 7.
22. Criar a senha em `/redefinir-senha`; cair em `/login` com "Senha alterada"; entrar. Esperado: `/admin` com o aviso amarelo de dados de demonstração.
23. Conferir: `/portal` redireciona o administrador para `/admin`; "Sair" volta ao login; `/admin` sem sessão vai ao login com `?next=`.
24. "Esqueci minha senha": o e-mail chega, o link aponta para `localhost`, a nova senha funciona e a sessão antiga é encerrada.
25. Conferir no painel (Authentication > Users) que existe **só** o administrador e que ninguém consegue se cadastrar sozinho.

> **Resultado em 2026-11-02:** passos 19 e 20 concluídos (administrador `admin@luvicompany.com.br`, papel `admin`); passos 21 a 23 e 25 aprovados (testes manuais do usuário e checagens do assistente). O passo **24 (recuperação de senha por e-mail) não foi testado**: depende de SMTP próprio (`EMAIL-RESEND.md`). Se o convite impresso expirar, o bootstrap não roda de novo (já existe perfil): peça um novo link.
> Se aparecer "Este link expirou ou já foi usado" com o convite ainda válido, pode ser falha de rede, não o link: veja `DIAGNOSTICO-REDE.md` (`npm run net:check`).

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
- **Privilégios padrão do Supabase:** o pré-voo no projeto real mostrou que o Supabase concede `anon`, `authenticated` e `service_role` por padrão aos objetos criados por `postgres` e `supabase_admin`. A migration 1 revoga isso para objetos futuros criados pelo `postgres` (no schema `public` **e** no nível global, porque revogar só o schema deixava o padrão global ativo, coberto em teste). Objetos criados por `supabase_admin` (papel interno) não são afetados; o `verify.sql` confere o resultado final.
- O projeto existente pode ter sido criado com configurações diferentes das de um projeto novo (cadastro livre ligado, Redirect URLs antigas, extensões extras): a seção 5.2 e o `preflight.sql` existem para pegar isso antes de qualquer alteração.
