# Recuperação de senha e SMTP com o Resend — o que falta

> **Atualização (2026-11-04):** o app já envia **convites, links de aprovação e códigos** pelo Resend (`EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`), com modelos próprios e erros tratados; o convite de aprovador é enviado pelo painel. Falta **testar com um e-mail real** (com a sua autorização) e configurar o **SMTP do Supabase Auth** para a recuperação de senha. Passo a passo de produção: `docs/PRODUCAO.md`.

Estado em **2026-11-02**. Objetivo: e-mails de **recuperação de senha** e **convite** do Supabase Auth saindo pelo Resend, em português e com a identidade Luvi, para qualquer destinatário.

Convenção: **[Você]** = ação no painel/DNS por conta do usuário; **[Eu]** = o assistente pode fazer, se autorizado.

## 1. Onde estamos

- **Código pronto e testado:** `/esqueci-senha` → `requestPasswordResetAction` (envia `redirectTo = APP_URL/auth/recovery`) → link do e-mail → `/auth/recovery` (`src/lib/auth/confirm.ts`, aceita `?code=` e `token_hash`) → `/redefinir-senha` → login. A troca de senha encerra todas as sessões.
- **O que o Auth usa hoje:** o SMTP **padrão** do Supabase. Segundo a documentação do Supabase, ele só entrega para endereços da equipe da organização (outros falham com "Email address not authorized"), limita a **2 mensagens por hora** e **não tem SLA**; é para testes. Por isso a recuperação **por e-mail não foi testada**: o convite do administrador foi feito por link impresso no terminal (sem e-mail).
- **Modelos prontos, não aplicados:** `supabase/templates/recovery.html` e `invite.html`. O painel só deixa editar os modelos depois de configurar SMTP próprio.
- **Chave do Resend:** `RESEND_API_KEY` está documentada em `.env.example`, mas o código ainda **não a lê** (e-mails do app são da Fase 3). Para o SMTP do Auth a chave vai **só no painel do Supabase**.

## 2. O que a verificação de DNS mostrou (consulta pública, só leitura)

| Registro | Valor encontrado | Leitura |
|---|---|---|
| `resend._domainkey.luvicompany.com.br` TXT | chave pública DKIM (`p=MIGf…`) | seletor `resend._domainkey` é o padrão de DKIM do Resend |
| `send.luvicompany.com.br` MX | `10 feedback.forge.rmta.net` | registro de retorno de envio |
| `send.luvicompany.com.br` TXT | `v=spf1 ip4:… ~all` | SPF do subdomínio de envio |
| `luvicompany.com.br` TXT | `v=spf1 include:_spf.mail.hostinger.com ~all` | SPF da raiz só cobre a Hostinger |
| `_dmarc.luvicompany.com.br` TXT | `v=DMARC1; p=none` | DMARC existe, em modo de monitoramento |
| `luvicompany.com.br` MX | `mx1/mx2.hostinger.com` | **a caixa de e-mail do domínio é da Hostinger** |

Leitura provável: o domínio `luvicompany.com.br` **já foi configurado no Resend** (o site institucional usa Resend). **Isto é inferência a partir do DNS**: só o painel do Resend mostra se o domínio está "Verified" e em qual conta/região. A documentação do Resend para o Supabase lista "domínio verificado" como pré-requisito.

## 3. O que falta, exatamente

### Decisões

1. **Remetente:** um endereço de um domínio verificado no Resend. Sugestão: `Aprova Luvi <no-reply@luvicompany.com.br>`. O Resend recomenda enviar de subdomínios para isolar reputação; se preferir um subdomínio (ex.: `aprova.luvicompany.com.br`), ele precisa ser adicionado e verificado à parte no Resend.
2. **Quem recebe a recuperação do administrador:** `admin@luvicompany.com.br` só recebe e-mail se a **caixa existir na Hostinger** (MX do domínio). Se não existir, a recuperação "envia" para lugar nenhum: crie a caixa/alias ou troque o e-mail do administrador.

### [Você] no Resend

3. Abrir o painel da conta do Resend usada pelo site e conferir que `luvicompany.com.br` está **Verified** (SPF e DKIM). Se não estiver, completar os registros que o painel indicar.
4. Criar uma **chave de API nova**, só para o Supabase de desenvolvimento (nome sugerido: `aprova-luvi-supabase-dev`), com a menor permissão que o painel oferecer para envio e restrita a esse domínio, se o painel permitir. **Nunca reutilizar a chave do site** (`RESEND_API_KEY` da Vercel do `site-luvi`). A chave de produção será outra, criada depois.

### [Você] no Supabase (projeto DB Aprova Luvi)

5. Authentication > Emails > **SMTP Settings**: ligar o SMTP próprio com **host** `smtp.resend.com`, **porta** `465`, **usuário** `resend`, **senha** = a chave criada no passo 4, **e-mail do remetente** e **nome** (`Aprova Luvi`) — ambos obrigatórios.
6. Authentication > **Rate Limits**: depois de salvar o SMTP, a documentação do Supabase informa um limite inicial de **30 mensagens por hora**; ajuste se necessário.
7. Authentication > Emails > **Templates**: colar `supabase/templates/recovery.html` (Reset Password) e `supabase/templates/invite.html` (Invite user). Eles usam `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=…`, e por isso o link funciona **em qualquer navegador** (o modelo padrão, com `?code=`, exige abrir o e-mail no mesmo navegador do pedido).
8. Authentication > URL Configuration: manter `Site URL = http://localhost:3000` e **Redirect URLs = só `http://localhost:3000/auth/*`** neste projeto de desenvolvimento.

### [Eu] ou [Você] — teste

9. Subir o app (`npm run dev`), abrir `/esqueci-senha`, pedir a recuperação para um endereço **de teste que você controle**. Esperado: e-mail em português, botão apontando para `http://localhost:3000/auth/recovery?token_hash=…`; ao abrir, cai em `/redefinir-senha`; a nova senha funciona e a sessão antiga é encerrada.
10. Conferir que a mensagem na tela é a **mesma** para e-mail existente e inexistente (o app não revela quais contas existem).

### Produção (depois, em outro projeto Supabase)

11. Repetir 5–8 no projeto **de produção**, com chave do Resend própria, `Site URL = https://aprova.luvicompany.com.br` e Redirect URLs `https://aprova.luvicompany.com.br/auth/*`. Não colocar o domínio de produção no projeto de desenvolvimento.
12. Fortalecer o e-mail do domínio: o DMARC está em `p=none`; só subir para `quarantine`/`reject` depois de acompanhar os relatórios e confirmar que todo remetente legítimo (Hostinger, Resend) passa em SPF/DKIM.

## 4. Riscos e limites

- **Nenhuma configuração remota foi alterada** pelo assistente (Supabase, Resend, DNS).
- Enquanto o SMTP próprio não existe, **não dependa de e-mail**: para um novo link de convite/recuperação do administrador use o procedimento por link do `scripts/bootstrap-admin.mjs` (apenas em banco vazio) ou o painel do Supabase; peça ajuda se precisar.
- A chave do Resend vale como senha de envio: só no painel do Supabase (e depois na Vercel como Sensitive). Nunca em chat, repositório ou `.env.local` deste projeto.
- Os e-mails do **app** (novo material, decisão tomada, lembretes) são da **Fase 3** e usarão a API do Resend com outra chave (`RESEND_API_KEY`), lida no servidor.
- Rede instável de desenvolvimento (`docs/DIAGNOSTICO-REDE.md`) pode atrapalhar o teste ponta a ponta: use `npm run net:check` antes.

## 5. Teste de envio real em desenvolvimento (`npm run email:test`)

Script `scripts/send-test-email.mjs`: envia **um** e-mail de teste com assunto e conteúdo fixos (sem link, token ou código), pela mesma `sendEmail` do app. Exige `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` e `EMAIL_FROM` no `.env.local` (confira antes com `npm run env:check`: precisa mostrar `emailProvider: resend`).

```
npm run email:test -- --to voce@seu-dominio.com.br
npm run email:test -- --to voce@seu-dominio.com.br --execute --project-host <host do SUPABASE_URL>
```

O primeiro comando é **simulação** (valida a configuração, não abre conexão e não envia). O segundo envia de verdade, só com `--execute` e com o host do projeto de desenvolvimento. Recusa produção e provedor simulado; nunca imprime a chave nem o corpo da mensagem. "Aceito pelo Resend" significa que o Resend recebeu o pedido: confira a caixa de entrada, o spam e o painel do Resend (Emails).
