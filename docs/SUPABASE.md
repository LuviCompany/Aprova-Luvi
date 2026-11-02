# Configuração do Supabase — Aprova Luvi

Guia para ligar a Fase 2 a um projeto Supabase **novo e exclusivo do Aprova Luvi**. Nada aqui toca o site institucional nem o ambiente de produção atual.

## O que é necessário

| Serviço | Para quê | Plano |
|---|---|---|
| Supabase (Postgres, Auth, Storage) | banco, login, arquivos privados | Free serve para validar; limite de 50 MB por arquivo e 1 GB de storage |
| Resend (Fase 3) | e-mails de notificação e código de verificação do link | não necessário agora |
| SMTP próprio no Supabase Auth (recomendado) | e-mails de convite e recuperação de senha | o SMTP padrão do Supabase tem limite baixo de envios por hora; para uso real, configure um SMTP (pode ser o próprio Resend) |

## Variáveis de ambiente

| Variável | Onde obter | Visibilidade |
|---|---|---|
| `SUPABASE_URL` | Project Settings > API > Project URL | servidor |
| `SUPABASE_ANON_KEY` | Project Settings > API > chave `anon` / `publishable` | servidor |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings > API > chave `service_role` / `secret` | **SECRETA, só servidor** |
| `NEXT_PUBLIC_APP_URL` | domínio do app (`https://aprova.luvicompany.com.br`) | servidor/links de e-mail |

A chave `service_role` ignora a RLS. Nunca cole em chat, commit, print ou variável `NEXT_PUBLIC_*`. Na Vercel, cadastre em Settings > Environment Variables, marcada como **Sensitive**.

## Passo a passo

1. **Criar o projeto** no Supabase (região `South America (São Paulo)`), com senha de banco forte guardada em gerenciador de senhas.
2. **Aplicar as migrations**, em ordem, de `supabase/migrations/` (SQL Editor, ou `supabase link` + `supabase db push`):
   `…_core_schema.sql` → `…_functions.sql` → `…_rls_policies.sql` → `…_storage.sql`.
3. **Authentication > Sign In / Providers > Email**: manter e-mail ligado e **desligar "Allow new users to sign up"**. Sem isso qualquer pessoa criaria conta (ela não teria acesso, pois não há perfil, mas a conta existiria).
4. **Authentication > URL Configuration**: `Site URL` = domínio do app; em `Redirect URLs`, adicionar `https://aprova.luvicompany.com.br/auth/confirm` (e `http://localhost:3000/auth/confirm` para desenvolvimento).
5. **Authentication > Email Templates**: colar o conteúdo de `supabase/templates/recovery.html` (Reset Password) e `supabase/templates/invite.html` (Invite user). O link usa `token_hash` e termina em `/auth/confirm`, que valida no servidor.
6. **Authentication > Attack Protection**: ligar proteção contra senhas vazadas e manter os limites de tentativa padrão.
7. **Storage**: conferir que o bucket `materials` existe e está **privado** (a migration 4 o cria).
8. **Criar o primeiro administrador** (na sua máquina, com a chave de serviço só no terminal):

   ```bash
   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_APP_URL=https://aprova.luvicompany.com.br node scripts/bootstrap-admin.mjs --email voce@luvicompany.com.br --name "Seu Nome"
   ```

   O script convida por e-mail (ninguém define senha por terceiros) e só roda em banco vazio.
9. **Vercel**: cadastrar as variáveis acima. **Remover `APROVA_DEMO_MODE`** (ou deixá-la ausente): com o Supabase configurado a demonstração já desliga sozinha.

## Cuidados antes de habilitar usuários reais

- O painel e o portal **ainda leem dados fictícios** (`src/lib/mock`) até os Módulos 3 e 4. A autenticação e a RLS já são reais, mas **não cadastre clientes reais** antes disso.
- O fluxo de aprovação rápida (`/aprovar/[token]`) está **fechado** fora do modo demonstração: todo token responde "link inválido" até o Módulo 4.
- Testes de banco (`npm run test:db`) rodam as migrations num Postgres em memória e provam o isolamento entre clientes; rode-os sempre que alterar `supabase/migrations/`. **Nunca edite uma migration já aplicada**: crie uma nova.
