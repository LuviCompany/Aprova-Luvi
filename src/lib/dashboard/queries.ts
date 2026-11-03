import "server-only";
import { z } from "zod";
import { DataLoadError } from "@/lib/clients/queries";
import { listClientOptions } from "@/lib/clients/queries";
import { listMaterialProjectOptions } from "@/lib/materials/queries";
import { MATERIAL_STATUSES, MATERIAL_TYPES } from "@/lib/materials/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DashboardDecision, DashboardMaterial } from "./metrics";

/**
 * Leitura do dashboard (Módulo 3, etapa E): sempre com o cliente Supabase do usuário, sob a RLS. Os limites
 * evitam respostas gigantes; `truncated` avisa quando o painel está vendo só parte dos materiais.
 */

export const DASHBOARD_MATERIALS_SELECT = "id, title, type, status, due_date, created_at, clients(name)";
export const DASHBOARD_DECISIONS_SELECT = "id, material_id, decision, via, created_at, approvers(name), approval_requests(created_at)";
export const MATERIAL_LIMIT = 1000;
export const DECISION_LIMIT = 500;

export interface DashboardData {
  materials: DashboardMaterial[];
  decisions: DashboardDecision[];
  activeClients: number;
  activeProjects: number;
  truncated: boolean;
}

const materialRow = z.object({
  id: z.uuid(),
  title: z.string(),
  type: z.enum(MATERIAL_TYPES),
  status: z.enum(MATERIAL_STATUSES),
  due_date: z.string().nullable(),
  created_at: z.string(),
  clients: z.object({ name: z.string() }).nullable(),
});

const one = <T extends z.ZodType>(schema: T) => z.union([schema, z.array(schema).transform((rows) => rows[0] ?? null), z.null()]);
const decisionRow = z.object({
  id: z.uuid(),
  material_id: z.uuid(),
  decision: z.enum(["aprovado", "alteracao"]),
  via: z.enum(["portal", "link"]),
  created_at: z.string(),
  approvers: one(z.object({ name: z.string() })),
  approval_requests: one(z.object({ created_at: z.string() })),
});

export async function loadDashboard(): Promise<DashboardData> {
  const supabase = await createSupabaseServerClient();
  const [materialsResult, decisionsResult, clients, projects] = await Promise.all([
    supabase.from("materials").select(DASHBOARD_MATERIALS_SELECT).order("created_at", { ascending: false }).limit(MATERIAL_LIMIT),
    supabase.from("decisions").select(DASHBOARD_DECISIONS_SELECT).order("created_at", { ascending: false }).limit(DECISION_LIMIT),
    listClientOptions(),
    listMaterialProjectOptions(),
  ]);
  if (materialsResult.error) throw new DataLoadError("os materiais", materialsResult.error.message);
  if (decisionsResult.error) throw new DataLoadError("as decisões", decisionsResult.error.message);

  const materials = z.array(materialRow).safeParse(materialsResult.data);
  const decisions = z.array(decisionRow).safeParse(decisionsResult.data);
  if (!materials.success || !decisions.success) throw new DataLoadError("o painel", "resposta inesperada");

  return {
    materials: materials.data.map((row) => ({
      id: row.id,
      title: row.title,
      type: row.type,
      status: row.status,
      clientName: row.clients?.name ?? "—",
      dueDate: row.due_date,
      createdAt: row.created_at,
    })),
    decisions: decisions.data.map((row) => ({
      id: row.id,
      materialId: row.material_id,
      decision: row.decision,
      by: row.approvers?.name ?? "Aprovador",
      via: row.via,
      at: row.created_at,
      requestedAt: row.approval_requests?.created_at ?? null,
    })),
    activeClients: clients.filter((c) => c.active).length,
    activeProjects: projects.filter((p) => p.status === "ativo").length,
    truncated: materials.data.length >= MATERIAL_LIMIT,
  };
}
