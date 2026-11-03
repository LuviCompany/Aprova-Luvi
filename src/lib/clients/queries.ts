import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CLIENT_OPTIONS_SELECT, CLIENT_SELECT, PROJECT_SELECT } from "./selects";
import {
  PROJECT_STATUSES,
  escapeLike,
  type ClientFilters,
  type ProjectFilters,
  type ProjectStatusValue,
} from "./schema";

/**
 * Leitura de clientes e projetos. Usa SEMPRE o cliente Supabase do usuário (chave publicável +
 * sessão): quem decide o que cada um enxerga é a RLS, nunca a chave secreta.
 */

const LIMIT = 500;

export class DataLoadError extends Error {
  constructor(what: string, cause?: string) {
    super(`Não foi possível carregar ${what}.${cause ? ` (${cause})` : ""}`);
    this.name = "DataLoadError";
  }
}

export interface ApproverItem {
  id: string;
  name: string;
  email: string;
  jobTitle: string;
  active: boolean;
}

export interface ClientListItem {
  id: string;
  name: string;
  segment: string;
  initials: string;
  active: boolean;
  projectCount: number;
  /** Materiais do cliente aguardando aprovação. */
  pendingCount: number;
  approvers: ApproverItem[];
}

export interface ProjectListItem {
  id: string;
  clientId: string;
  clientName: string;
  clientActive: boolean;
  name: string;
  description: string;
  status: ProjectStatusValue;
  dueDate: string | null;
  materialCount: number;
  approvedCount: number;
}

export interface ClientOption {
  id: string;
  name: string;
  active: boolean;
}

/** `projects(count)` chega como `[{ count: n }]`. */
const countSchema = z.array(z.object({ count: z.number() })).transform((rows) => rows[0]?.count ?? 0);

const clientRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  segment: z.string(),
  initials: z.string(),
  active: z.boolean(),
  projects: countSchema,
  pending: countSchema,
  approvers: z.array(
    z.object({ id: z.uuid(), name: z.string(), email: z.string(), job_title: z.string(), active: z.boolean() }),
  ),
});

const projectRowSchema = z.object({
  id: z.uuid(),
  client_id: z.uuid(),
  name: z.string(),
  description: z.string(),
  status: z.enum(PROJECT_STATUSES),
  due_date: z.string().nullable(),
  clients: z.object({ name: z.string(), active: z.boolean() }).nullable(),
  materials: countSchema,
  approved: countSchema,
});

const optionRowSchema = z.object({ id: z.uuid(), name: z.string(), active: z.boolean() });

export async function listClients(filters: ClientFilters): Promise<ClientListItem[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("clients")
    .select(CLIENT_SELECT)
    .eq("pending.status", "aguardando")
    .order("name")
    .limit(LIMIT);
  if (filters.status === "ativos") query = query.eq("active", true);
  if (filters.status === "arquivados") query = query.eq("active", false);
  if (filters.q) query = query.ilike("name", `%${escapeLike(filters.q)}%`);

  const { data, error } = await query;
  if (error) throw new DataLoadError("os clientes", error.message);
  const parsed = z.array(clientRowSchema).safeParse(data);
  if (!parsed.success) throw new DataLoadError("os clientes", "resposta inesperada");

  return parsed.data.map((row) => ({
    id: row.id,
    name: row.name,
    segment: row.segment,
    initials: row.initials,
    active: row.active,
    projectCount: row.projects,
    pendingCount: row.pending,
    approvers: row.approvers.map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      jobTitle: a.job_title,
      active: a.active,
    })),
  }));
}

export async function listProjects(filters: ProjectFilters): Promise<ProjectListItem[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("projects")
    .select(PROJECT_SELECT)
    .eq("approved.status", "aprovado")
    .order("name")
    .limit(LIMIT);
  // Só UUID vira filtro: qualquer outro valor da URL é ignorado (nunca chega ao Postgres como texto solto).
  if (filters.clientId && z.uuid().safeParse(filters.clientId).success) query = query.eq("client_id", filters.clientId);
  if (filters.status !== "todos") query = query.eq("status", filters.status);
  if (filters.q) query = query.ilike("name", `%${escapeLike(filters.q)}%`);

  const { data, error } = await query;
  if (error) throw new DataLoadError("os projetos", error.message);
  const parsed = z.array(projectRowSchema).safeParse(data);
  if (!parsed.success) throw new DataLoadError("os projetos", "resposta inesperada");

  return parsed.data.map((row) => ({
    id: row.id,
    clientId: row.client_id,
    clientName: row.clients?.name ?? "—",
    clientActive: row.clients?.active ?? false,
    name: row.name,
    description: row.description,
    status: row.status,
    dueDate: row.due_date,
    materialCount: row.materials,
    approvedCount: row.approved,
  }));
}

/** Clientes para os seletores (formulário de projeto e filtro). */
export async function listClientOptions(): Promise<ClientOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("clients").select(CLIENT_OPTIONS_SELECT).order("name").limit(LIMIT);
  if (error) throw new DataLoadError("os clientes", error.message);
  const parsed = z.array(optionRowSchema).safeParse(data);
  if (!parsed.success) throw new DataLoadError("os clientes", "resposta inesperada");
  return parsed.data;
}
