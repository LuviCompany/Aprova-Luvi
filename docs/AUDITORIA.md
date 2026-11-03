# Auditoria — o que é registrado e política de retenção proposta

Estado em **2026-11-02** (Módulo 3, etapa A.2). A tabela `public.audit_events` já existia (migration 1); a migration **M4** (`20261103120300_audit_clients_projects_approvers.sql`) passa a alimentá-la também com clientes, projetos, aprovadores e convites. **A M4 ainda não foi aplicada em nenhum projeto Supabase.**

## 1. O que cada evento contém

| Campo (`audit_events`) | Conteúdo | Atende a exigência |
|---|---|---|
| `organization_id` | Organização do cliente afetado (derivada do cliente, nunca do navegador) | organização |
| `actor_profile_id` | `auth.uid()` de quem agiu: o **perfil** do responsável. Nulo quando a ação é do servidor (`service_role`: bootstrap, rotinas) | identificador do responsável |
| `entity_type` + `entity_id` | Tipo (`client`, `project`, `approver`, `approver_invite`) e `id` do registro afetado | registro afetado |
| `action` | Tipo da ação (tabela abaixo) | tipo da ação |
| `created_at` | Data e hora do banco (`now()`), imutável | data/hora |
| `metadata` | Só: `client_id`, `actor_role` (papel do responsável naquele momento), `changed` (**nomes** das colunas alteradas) e, para status/ativo, `status_from` e `status_to` | rastreabilidade sem dados pessoais |

### Ações

`client.created`, `client.updated`, `client.archived`, `client.reactivated`, `project.created`, `project.updated` (com `status_from`/`status_to` quando o status muda), `approver.created`, `approver.linked` (vínculo de uma pessoa a outro cliente), `approver.updated`, `approver.deactivated`, `approver.reactivated`, `approver_invite.prepared`, `approver_invite.revoked` (e `sent`, `accepted`, `expired` quando a Fase 3 existir).

Já existiam: `version.created`, `file.added`, `approval_request.created`, `approval_link.created`, `approval_link.revoked`, `approval_request.cancelled`, `decision.recorded`.

## 2. O que NUNCA é gravado

Nome, e-mail, cargo, segmento, descrição, título, texto livre, valores antigos e novos de campos de texto. A auditoria é **imutável** (gatilhos impedem `UPDATE`, `DELETE` e `TRUNCATE`), então qualquer dado pessoal gravado ali não poderia ser apagado depois. Por isso o evento aponta para o registro por `id` e lista só **quais colunas** mudaram. Para saber o valor, consulta-se o próprio registro (que pode ser corrigido ou anonimizado); para saber **quem, quando e o quê**, basta o evento.

Garantias testadas (`src/test/db/approvers-a2.test.ts`): o `metadata` só tem as cinco chaves acima; o JSON do evento não contém nenhum dos nomes, e-mails, segmentos ou títulos usados nos testes; atualização que só mexe em `updated_at` não gera evento; falha na operação não deixa evento órfão (a auditoria roda na mesma transação).

## 3. Quem lê e quem escreve

- **Lê:** só administradores da organização (policy `audit_select_admin`). Atendimento, designer e aprovadores recebem 0 linhas.
- **Escreve:** só gatilhos `SECURITY DEFINER` do banco (`app.audit_row_change`) e funções internas (`app.write_audit`). O app não tem `INSERT` na tabela, e as funções de auditoria não são executáveis por `anon` nem `authenticated` (`verify.sql` confere).
- **Altera ou apaga:** ninguém (gatilhos de imutabilidade).
- Não há tela de auditoria nesta etapa (Fase 4).

## 4. Política de retenção proposta (a validar com a assessoria jurídica e o encarregado de dados)

> Proposta técnica, **não** é parecer jurídico. Os prazos abaixo são pontos de partida para decisão.

1. **Finalidade:** prestação de contas das aprovações e da administração de clientes, segurança e resolução de disputas com clientes.
2. **Prazo sugerido:** manter os eventos por **5 anos** a partir da data do evento (cobre prazos usuais de prescrição civil e de relação contratual), e rever o prazo quando o contrato com o cliente definir outro.
3. **Dados pessoais:** o evento só guarda **identificadores** (`actor_profile_id`, `entity_id`). Esses ids são pseudônimos: só identificam alguém se cruzados com `profiles`/`approvers`. Ao atender um pedido de **exclusão/anonimização** (LGPD), anonimiza-se a linha do perfil ou do aprovador (nome, e-mail, cargo) e **mantém-se o `id`**; a auditoria continua íntegra e já não identifica a pessoa. Usuários e aprovadores são **desativados, não apagados**, justamente para isso.
4. **Expurgo ao fim do prazo:** por ser imutável, o expurgo é um **procedimento excepcional**, nunca uma rotina do app: executado por quem tem acesso ao banco, com autorização registrada, exportando antes (arquivo morto) e desligando o gatilho de imutabilidade só dentro de uma migration/rotina revisada. Para facilitar, a Fase 4 deve avaliar **particionar `audit_events` por mês** (descarte de partição antiga, sem `DELETE` em massa).
5. **Backup e cópia:** a auditoria entra no backup do banco; a política de backup (Pro/PITR) vale para ela. Exportações para arquivo morto seguem a mesma classificação de dado e ficam em local com acesso restrito.
6. **Acesso:** só administradores; leituras de auditoria fora do painel (SQL, exportação) devem ser raras e registradas no controle de acesso do projeto Supabase.
7. **Revisão:** reavaliar esta política a cada fase e quando a lei, o contrato ou o volume mudarem.

## 5. Limites conhecidos

- O ator é o `auth.uid()` do **perfil**. Ações do servidor com `service_role` ficam sem ator (ex.: criação do administrador pelo `bootstrap-admin`).
- Decisões por **link** (aprovador sem login) usam o `actor_approver_id` (`decision.recorded`, já existente), não o perfil.
- Não há IP, user-agent nem origem da requisição nos eventos desta etapa (`ip_hash` existe na tabela e é usado nas decisões; para clientes e projetos o app não passa pelo banco com esse dado).
- A auditoria **não** substitui logs de acesso da hospedagem (ver o item de tokens em logs no `docs/CHECKLIST-LANCAMENTO.md`).
