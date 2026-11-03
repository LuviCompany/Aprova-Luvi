/**
 * Colunas lidas nas telas de materiais (etapa B). Arquivo sem importações, como `clients/selects`.
 * `versions` é o número de versões (a etapa B não cria versões: fica 0 até a etapa C/D).
 */
export const MATERIAL_LIST_SELECT =
  "id, client_id, project_id, title, type, aspect_ratio, channel, status, publish_date, due_date, created_at, clients(name, active), projects(name, status), versions:material_versions(count)";

export const MATERIAL_DETAIL_SELECT =
  "id, client_id, project_id, title, description, caption, type, aspect_ratio, channel, status, publish_date, due_date, created_at, updated_at, clients(name, active), projects(name, status), versions:material_versions(count)";

/** Projetos para o seletor do formulário (com o cliente, para filtrar em cascata). */
export const MATERIAL_PROJECT_OPTIONS_SELECT = "id, client_id, name, status";
