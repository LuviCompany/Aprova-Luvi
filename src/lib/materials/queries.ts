import "server-only";
import { z } from "zod";
import { DataLoadError, listClientOptions, type ClientOption } from "@/lib/clients/queries";
import { PROJECT_STATUSES, escapeLike, type ProjectStatusValue } from "@/lib/clients/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MATERIAL_DETAIL_SELECT, MATERIAL_LIST_SELECT, MATERIAL_PROJECT_OPTIONS_SELECT } from "./selects";
import {
  ASPECT_RATIOS,
  MATERIAL_STATUSES,
  MATERIAL_TYPES,
  PAGE_SIZE,
  type AspectRatio,
  type MaterialFilters,
} from "./schema";
import type { MaterialStatus, MaterialType } from "@/lib/types";

/**
 * Leitura de materiais. Usa SEMPRE o cliente Supabase do usuário (chave publicável + sessão): quem
 * decide o que cada um enxerga é a RLS, nunca a chave secreta.
 */

export interface MaterialListItem {
  id: string;
  clientId: string;
  clientName: string;
  projectId: string;
  projectName: string;
  title: string;
  type: MaterialType;
  aspectRatio: AspectRatio | null;
  channel: string;
  status: MaterialStatus;
  publishDate: string | null;
  dueDate: string | null;
  versionCount: number;
}

export interface MaterialDetail extends MaterialListItem {
  description: string;
  caption: string;
  clientActive: boolean;
  projectStatus: ProjectStatusValue;
  createdAt: string;
  updatedAt: string;
}

export interface MaterialPage {
  items: MaterialListItem[];
  total: number;
  page: number;
  pageCount: number;
}

export interface MaterialProjectOption {
  id: string;
  clientId: string;
  name: string;
  status: ProjectStatusValue;
}

/** `material_versions(count)` chega como `[{ count: n }]`. */
const countSchema = z.array(z.object({ count: z.number() })).transform((rows) => rows[0]?.count ?? 0);

const baseRow = {
  id: z.uuid(),
  client_id: z.uuid(),
  project_id: z.uuid(),
  title: z.string(),
  type: z.enum(MATERIAL_TYPES),
  aspect_ratio: z.enum(ASPECT_RATIOS).nullable(),
  channel: z.string(),
  status: z.enum(MATERIAL_STATUSES),
  publish_date: z.string().nullable(),
  due_date: z.string().nullable(),
  clients: z.object({ name: z.string(), active: z.boolean() }).nullable(),
  projects: z.object({ name: z.string(), status: z.enum(PROJECT_STATUSES) }).nullable(),
  versions: countSchema,
};

const listRowSchema = z.object({ ...baseRow, created_at: z.string() });
const detailRowSchema = z.object({
  ...baseRow,
  description: z.string(),
  caption: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

const projectOptionSchema = z.object({
  id: z.uuid(),
  client_id: z.uuid(),
  name: z.string(),
  status: z.enum(PROJECT_STATUSES),
});

function toListItem(row: z.infer<typeof listRowSchema>): MaterialListItem {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.clients?.name ?? "—",
    projectId: row.project_id,
    projectName: row.projects?.name ?? "—",
    title: row.title,
    type: row.type,
    aspectRatio: row.aspect_ratio,
    channel: row.channel,
    status: row.status,
    publishDate: row.publish_date,
    dueDate: row.due_date,
    versionCount: row.versions,
  };
}

export async function listMaterials(filters: MaterialFilters): Promise<MaterialPage> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("materials")
    .select(MATERIAL_LIST_SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id");
  // Só UUID vira filtro: qualquer outro valor da URL é ignorado (nunca chega ao Postgres como texto solto).
  if (filters.clientId && z.uuid().safeParse(filters.clientId).success) query = query.eq("client_id", filters.clientId);
  if (filters.projectId && z.uuid().safeParse(filters.projectId).success) query = query.eq("project_id", filters.projectId);
  if (filters.status !== "todos") query = query.eq("status", filters.status);
  if (filters.type !== "todos") query = query.eq("type", filters.type);
  if (filters.q) query = query.ilike("title", `%${escapeLike(filters.q)}%`);

  const from = (filters.page - 1) * PAGE_SIZE;
  const { data, error, count } = await query.range(from, from + PAGE_SIZE - 1);
  if (error) throw new DataLoadError("os materiais", error.message);
  const parsed = z.array(listRowSchema).safeParse(data);
  if (!parsed.success) throw new DataLoadError("os materiais", "resposta inesperada");

  const total = count ?? parsed.data.length;
  return {
    items: parsed.data.map(toListItem),
    total,
    page: filters.page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

/** Detalhe de um material, ou `null` se não existir ou a RLS não o mostrar (as duas respostas são iguais). */
export async function getMaterial(id: string): Promise<MaterialDetail | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("materials").select(MATERIAL_DETAIL_SELECT).eq("id", id).maybeSingle();
  if (error) throw new DataLoadError("o material", error.message);
  if (!data) return null;
  const parsed = detailRowSchema.safeParse(data);
  if (!parsed.success) throw new DataLoadError("o material", "resposta inesperada");
  const row = parsed.data;
  return {
    ...toListItem(row),
    description: row.description,
    caption: row.caption,
    clientActive: row.clients?.active ?? false,
    projectStatus: row.projects?.status ?? "ativo",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Projetos para os seletores (o formulário usa só os não concluídos; o filtro, todos). O cliente é filtrado na tela. */
export async function listMaterialProjectOptions(): Promise<MaterialProjectOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("projects")
    .select(MATERIAL_PROJECT_OPTIONS_SELECT)
    .order("name")
    .limit(500);
  if (error) throw new DataLoadError("os projetos", error.message);
  const parsed = z.array(projectOptionSchema).safeParse(data);
  if (!parsed.success) throw new DataLoadError("os projetos", "resposta inesperada");
  return parsed.data.map((row) => ({ id: row.id, clientId: row.client_id, name: row.name, status: row.status }));
}

export { listClientOptions, type ClientOption };
