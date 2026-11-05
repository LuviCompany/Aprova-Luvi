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

## 7. Validação operacional no projeto de desenvolvimento (2026-11-04) — APROVADA

Ambiente: app em `next dev` (localhost:3000) contra o projeto "DB Aprova Luvi" (D1/D2 aplicadas), `SUPABASE_SECRET_KEY` do `.env.local`, **`APPROVAL_LINK_SECRET` aleatório só na memória do processo** e **e-mail simulado** (nada enviado de verdade; os "e-mails" foram lidos em `/api/dev/outbox`). Dados **fictícios "TESTE D"**: cliente "TESTE D Casa Vento", projeto "TESTE D Campanha", aprovadores `aprovador.d1@teste.invalid` e `aprovador.d2@teste.invalid`, material "TESTE D Post de validação" (PNG de 70 bytes). Eles **permanecem no dev** e não devem ser apagados sem autorização.

| # | Verificação | Resultado |
|---|---|---|
| 1 | Envio da v1 a 2 aprovadores: 2 solicitações individuais, material em *Aguardando*, conteúdo congelado | OK |
| 2 | Link do aprovador 1: antes do código só aparece a empresa e o e-mail mascarado (nada do material) | OK |
| 3 | Código errado: "Restam 4 tentativas"; código certo abre a revisão; imagem servida por URL assinada do storage privado (200, `image/png`) | OK |
| 4 | Aprovação por link do 1º: material continua *Em andamento* (1 de 2); link vira "já utilizado" | OK (política "todos aprovam") |
| 5 | Link do aprovador 2: 5 códigos errados (4, 3, 2, 1, 0 tentativas) e a 6ª, **mesmo com o código certo**, bloqueada; novo código logo em seguida recusado pelo intervalo de 1 min; após o intervalo, novo código aceito | OK |
| 6 | Tela do 2º: histórico mostra o colega só como "Outro aprovador"; nota de alteração curta bloqueia o botão; nota válida envia | OK |
| 7 | Pedido de alteração: material *Alteração solicitada*, 2 de 2 responderam, as duas decisões preservadas | OK |
| 8 | Revisão (motivo) → v2 em rascunho → arquivo novo → reenvio só ao aprovador 2 | OK |
| 9 | Link da v2 gerado e **revogado** pela equipe; ao abrir: "Link revogado" | OK |
| 10 | Cancelar o envio: solicitação *Cancelada*, material volta a *Rascunho* | OK |
| 11 | Consulta somente leitura ao banco: auditoria (`approval_link.created|revoked|verified`, `approval_request.cancelled`, `decision.recorded`, `material.submitted`, `material.revision_started`…) **sem** nome, e-mail, nota, token ou código no metadata; decisões com `ip_hash` de 64 hex e canal `link`; `code_hash`, `session_hash` e `token_hash` só em hex de 64; 3 links (2 usados, 1 revogado), 3 códigos (máx. 5 tentativas), 2 sessões, 2 conteúdos congelados | OK |
| 12 | Log do servidor | **ACHADO, corrigido:** o `next dev` imprimia cada Server Function **com os argumentos** (token, código de 6 dígitos e a nota) e cada GET com o token no caminho. Corrigido em `next.config.ts` (`logging.serverFunctions: false` e `incomingRequests.ignore` para `/aprovar`), com teste; reconferido: nenhuma linha de `/aprovar` no novo log. Isso só afeta o terminal de desenvolvimento (em produção o log é da hospedagem: ver seção 8). |

**Não coberto:** decisão **no portal** com login de aprovador (exige um usuário de papel *cliente* com senha, que o assistente não cria nem digita) — a regra está nos testes de banco e no E2E com mock; envio **real** de e-mail (Resend não configurado; nenhum e-mail real foi enviado). Aviso do Next em desenvolvimento ("Base UI ... nativeButton") vindo do botão "Voltar ao início" (`render={<Link />}`), anterior ao módulo e sem efeito funcional.

### 7.1 Portal autenticado com login real de aprovador (2026-11-04)

Conta de teste: "TESTE D Aprovador Portal" (e-mail do próprio usuário), criada por `scripts/invite-approver.mjs` rodado **no terminal do usuário** (link impresso só lá; a senha foi criada pelo usuário; o assistente não criou, definiu nem viu senha, cookie ou token). Dados fictícios "TESTE D".

| # | Verificação | Resultado |
|---|---|---|
| 1 | Perfil `cliente` ativo, mesma organização, ligado ao aprovador, 1 vínculo ativo; convite `enviado` | OK |
| 2 | Portal abre; dashboard por situação | **Falhou na 1ª tentativa e foi corrigido** (ver abaixo); depois OK |
| 3 | Isolamento (consulta somente leitura com `role authenticated` e o `uid` do aprovador, no banco real): vê só o cliente "TESTE D Casa Vento", seu projeto e seu material; 0 dados do TESTE A2 e do TESTE C; 0 auditoria, 0 links | OK |
| 4 | Material com imagem, legenda, conteúdo congelado e histórico (colegas aparecem só como "Outro aprovador") | OK (visto pelo usuário) |
| 5 | **Solicitar alteração** pelo portal (nota curta bloqueia o botão): decisão da v2 gravada com canal `portal`, aprovador certo, sem `link_id`; material em `alteracao`; solicitação `decidida`; auditoria `decision.recorded` com o ator = aprovador e só ids | OK |
| 6 | Painel admin refletiu: "Alteração solicitada · 1 de 1 responderam", nota e canal "portal" | OK |
| 7 | Revisão → v3 → reenvio → **Aprovar** pelo portal: decisão da v3 `aprovado` via portal; material `aprovado`; envio "Aprovada por todos"; 3 versões congeladas; histórico completo (4 decisões); auditoria sem nome, e-mail, nota, token ou código (0 ocorrências) | OK |

**Falha e correção (item 2).** `/portal` mostrava "Algo deu errado". Causa real: `listPortalMaterials` e `getPortalMaterial` aninhavam `approval_requests` direto em `materials`; **não existe chave estrangeira entre as duas** (a solicitação se liga à versão) e o Supabase respondeu `PGRST200`. Sessão, perfil e RLS estavam corretos. Correção: as solicitações vêm aninhadas em `material_versions` (a RLS continua entregando só as do aprovador). Prevenção: `src/test/db/postgrest-embeds.test.ts` confere no catálogo das migrations que **todo aninhamento dos selects do app existe como FK**; o mock do E2E agora recusa o aninhamento direto, como o PostgREST; o portal ganhou `error.tsx` com código de referência (`digest`).

**Observações:** (a) a decisão pelo portal não grava `ip_hash` nem user-agent (só a decisão por link grava); a identidade vem da sessão autenticada. (b) Um aprovador consegue ler, no banco, nome e e-mail dos **outros aprovadores do mesmo cliente** (política `approvers` do portal); o app não usa isso, mas é dado pessoal visível dentro da mesma empresa: restringir exige migration (decisão pendente). (c) o bloqueio de material de outra empresa com material enviado foi exercitado depois, na seção 7.2.

### 7.2 Isolamento com material enviado de OUTRA empresa (2026-11-04)

Material novo e fictício **"TESTE D2 Isolamento Casa Aurora"** (imagem de 70 bytes) criado no cliente **TESTE A2 Casa Aurora** e enviado ao aprovador `@teste.invalid` dele (nada preexistente foi alterado; nenhum e-mail, link ou usuário criado). Teste feito **com a sessão autenticada do aprovador TESTE D Casa Vento**, no navegador do app, e com uma consulta somente leitura sob `role authenticated` e o `uid` dele no banco real.

| Verificação | Resultado |
|---|---|
| Início do portal do aprovador TESTE D | só o material dele; nada de Casa Aurora |
| Página `/portal/materiais/<id da Casa Aurora>` | **"Página não encontrada — O endereço não existe ou você não tem acesso"**, idêntica à de um id inexistente; título, legenda e imagem **não vazam** (HTTP 200 pelo streaming do Next; o conteúdo é o da página 404, igual para id inexistente) |
| Arquivo `/portal/arquivos/<id do arquivo da Casa Aurora>` | **404, corpo vazio, sem `location`**; idêntico ao de arquivo inexistente |
| Banco (RLS): material, versões, arquivo, conteúdo congelado, solicitação, decisões, comentários e aprovador da Casa Aurora | **0 linhas** em todas |
| Storage (`storage.objects`, bucket `materials`) | **0 objetos** da Casa Aurora; os 3 visíveis são todos do próprio cliente (`bool_and` verdadeiro) |
| Controle positivo | o material do próprio cliente continua visível (1) |

**Resultado: bloqueio confirmado.** Link ou token não foram usados nem registrados.

**Privacidade, estado real (antes da D3):** a mesma consulta mostrou o aprovador lendo os **3 aprovadores do próprio cliente** — a exposição de colegas descrita na seção 7.1 **continua no projeto de dev até a D3 ser aplicada** (`MIGRACOES-D.md`, seção 7).

## 8. Limites e riscos conhecidos

- O token está no **caminho da URL**: logs de acesso da hospedagem podem registrá-lo. Mitigação: o token sozinho não basta (exige o código enviado ao e-mail do aprovador), uso único, expiração e revogação. Conferir retenção/filtros de log na hospedagem.
- O limite por IP usa `X-Forwarded-For` e memória por instância: é barreira extra; os limites que valem estão no banco.
- Trocar `APPROVAL_LINK_SECRET` invalida códigos e sessões em curso (links continuam válidos; basta pedir novo código).
- Sem SMTP, o fluxo por link não conclui (sem código). O portal autenticado independe disso.
- Notificações automáticas aos aprovadores (novo material, lembretes) são da Fase 3; hoje o aviso é o link gerado pela equipe.
