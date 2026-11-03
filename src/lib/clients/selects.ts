/**
 * Colunas lidas nas listagens. Ficam num arquivo sem importações para que o script de validação
 * (`scripts/check-queries.mjs`) rode exatamente estas consultas contra o banco, só leitura.
 *
 * `pending` e `approved` são o mesmo relacionamento (`materials`) com filtros diferentes: o
 * PostgREST aplica o filtro só ao recurso embutido, sem remover o cliente/projeto da resposta.
 */
export const CLIENT_SELECT =
  "id, name, segment, initials, active, projects(count), pending:materials(count), approvers(id, name, email, job_title, active)";

export const PROJECT_SELECT =
  "id, client_id, name, description, status, due_date, clients(name, active), materials(count), approved:materials(count)";

export const CLIENT_OPTIONS_SELECT = "id, name, active";

// Detalhe do cliente e aprovadores (etapa A.2)
export const CLIENT_DETAIL_SELECT = "id, name, segment, initials, active";
export const APPROVER_SELECT = "id, name, email, job_title, active, profile_id";
export const OTHER_APPROVER_SELECT = "id, client_id, name, email, job_title, active, profile_id, clients(name)";
export const INVITE_SELECT = "id, approver_id, status";
