# Módulo 4 — Motor de aprovação

Estado em **2026-11-04**: implementado e testado **localmente** (branch `fase-2`). As migrations D1/D2 foram **aplicadas no projeto de desenvolvimento em 2026-11-04** (`MIGRACOES-D.md`, seção 6; `verify.sql` 30/30 em 0), mas o fluxo **ainda não foi exercitado de ponta a ponta contra o Supabase real** (falta a validação operacional da seção 7). Testes: Vitest 836, E2E 121 (incluindo 11 do motor de aprovação).

## 1. Fluxo

1. A equipe abre `/admin/materiais/[id]` (rascunho com arquivos) → **Enviar para aprovação**: escolhe os aprovadores ativos do cliente, prazo e recado. Uma solicitação **por aprovador**, todas na mesma versão e rodada. O conteúdo apresentado é **congelado** (`material_version_contents`).
2. O aprovador entra em `/portal` (ou usa o link): dashboard por situação (aguardando você, aguardando os outros, em ajustes, aprovados), revisão com slides, legenda e conteúdo exatamente como enviado, comentários, histórico e a decisão.
3. **Aprovar** ou **Solicitar alteração** (descrição obrigatória, ≥10 caracteres). A decisão é imutável e registra aprovador, versão, canal (portal/link), data/hora e, no link, IP em HMAC.
4. **Política de aprovação final (padrão):** o material só fica *aprovado* quando **todos** os aprovadores da rodada aprovam. Se **qualquer um** pedir alteração, o material vai para *ajustes*, o restante da rodada é cancelado (links revogados) e todas as decisões já dadas ficam preservadas.
5. Revisão: *Iniciar revisão* (`start_material_revision`, motivo 10–500) cria a nova versão preservando versões, arquivos, conteúdo congelado e decisões; a equipe sobe os arquivos e **reenvia**. Uma nova versão só nasce sem solicitação aberta; solicitações e links da versão anterior estão encerrados, então **nenhum link antigo aprova versão velha** (o banco ainda confere "versão mais recente" ao decidir).
6. Cancelar o envio (equipe) cancela a rodada, revoga os links e devolve o material a rascunho; reenviar a mesma versão só é aceito se o conteúdo não mudou.

## 2. Aprovação por link (sem login)

- A equipe gera o link de **um** aprovador (reemitir revoga o anterior; validade 7 dias, máx. 30). Token de 256 bits; o banco guarda só o **SHA-256**. O endereço aparece **uma vez** para a equipe copiar e é enviado por e-mail ao aprovador.
- O aprovador abre `/aprovar/<token>`: antes de qualquer verificação **nada do material** aparece (só a empresa e o e-mail mascarado). Ele pede um **código de 6 dígitos** por e-mail; o banco guarda só o **HMAC** (segredo `APPROVAL_LINK_SECRET`). Limites no banco: 5 tentativas por código, 1 código/60 s, 5/hora por link, código vale 10 min. Limite extra por IP em memória (melhor esforço).
- Código certo → **sessão** de 30 min num cookie `httpOnly`, `SameSite=Lax`, `Secure` em produção, restrito a `/aprovar`, com nome por link. O navegador nunca fala com o banco: o servidor usa a chave secreta **somente neste fluxo** (`src/lib/link-approval`), e o `no-secret-key.test.ts` reprova qualquer outro uso.
- Arquivos: `/aprovar/<token>/arquivos/<id>` só responde com a sessão **deste** link e só para arquivos da versão em aprovação (URL assinada de 60 s, sem cache). No portal: `/portal/arquivos/<id>`, sob RLS.
- Portal e link se sincronizam: decidiu em um, o outro vira "link indisponível/fechado".
- Cabeçalhos de `/aprovar/*`: `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store`, `X-Robots-Tag: noindex`.
- **Nada sensível em log:** token, código e identificador de sessão nunca são registrados pelo app (testes de log); erros do banco viram mensagens fixas.

## 3. E-mail

`EMAIL_PROVIDER`: `resend` (envio real, exige `RESEND_API_KEY` e `EMAIL_FROM`; **não testado de verdade**) ou `simulated` (guarda só em memória; recusado em produção). Sem provedor, o app avisa e não finge enviar: a equipe copia o link e o aprovador não recebe código (o link fica inutilizável até haver SMTP). Exceção do E2E: `simulated` em build de produção só com `E2E_SIMULATED_EMAIL=true` **e** `APP_URL` de localhost. A rota `/api/dev/outbox` só responde com o provedor simulado.

## 4. Auditoria (só ids, canal e carimbos)

`material.submitted`, `decision.recorded` (aprovação/alteração), `approval_request.cancelled`, `approval_link.created|revoked|verified`, `material.revision_started`. Sem texto livre, token, código nem e-mail.

## 5. Dashboard do admin

Nova seção **Aguardando respostas**: por material, quem ainda não respondeu, data do envio e prazo (vencidos primeiro).

## 6. Testes

- Banco (PGlite): `approval-multi.test.ts` (envio, política, cancelamento, reenvio, código/tentativas) + os existentes adaptados; `verify.sql` com 30 blocos.
- App: ações do painel, do portal e do link; serviço do link; cookie; cabeçalhos; env; `no-secret-key`.
- E2E (`e2e/aprovacao.spec.ts`, app em :3103 + mock `mock-approval.mjs`): ciclo envio → portal → ajuste → v2 → reenvio → aprovação por portal e por link; link revogado; código inválido (5 tentativas → bloqueio → novo código); código e link expirados; arquivo protegido.
- O mock só dá à interface algo para reagir: **RLS, concorrência e limites reais são do banco** e estão nos testes de banco.

## 7. Validação operacional pendente (depende de aplicar D1/D2 e autorização)

Com dados fictícios no projeto de desenvolvimento: aplicar D1/D2 e rodar `verify.sql`; configurar `APPROVAL_LINK_SECRET`; usar SMTP/Resend **só com sua autorização** para um e-mail de teste; percorrer o ciclo (envio de 2 aprovadores, aprovação por portal e por link, pedido de alteração, revisão, reenvio); conferir auditoria sem dados pessoais; conferir que nenhum log do servidor contém token/código.

## 8. Limites e riscos conhecidos

- O token está no **caminho da URL**: logs de acesso da hospedagem podem registrá-lo. Mitigação: o token sozinho não basta (exige o código enviado ao e-mail do aprovador), uso único, expiração e revogação. Conferir retenção/filtros de log na hospedagem.
- O limite por IP usa `X-Forwarded-For` e memória por instância: é barreira extra; os limites que valem estão no banco.
- Trocar `APPROVAL_LINK_SECRET` invalida códigos e sessões em curso (links continuam válidos; basta pedir novo código).
- Sem SMTP, o fluxo por link não conclui (sem código). O portal autenticado independe disso.
- Notificações automáticas aos aprovadores (novo material, lembretes) são da Fase 3; hoje o aviso é o link gerado pela equipe.
