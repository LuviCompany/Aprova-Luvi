import "server-only";
import { z } from "zod";
import { loadReview, ReviewLoadError, type ReviewData } from "@/lib/approval/review";
import type { PortalLink } from "@/lib/auth/portal-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MaterialStatus, MaterialType } from "@/lib/types";

/**
 * Leituras do portal autenticado. Sempre com o cliente Supabase DO USUÁRIO: a RLS decide o que ele vê
 * (só materiais já enviados do próprio cliente e SOMENTE as próprias solicitações). A empresa escolhida
 * entra como filtro extra, para quem aprova por mais de uma empresa nunca misturar dados.
 */

export type PortalBucket = "pendente" | "aguardando_outros" | "ajustes" | "aprovado";

export interface PortalMaterialItem {
  id: string;
  title: string;
  type: MaterialType;
  channel: string;
  status: MaterialStatus;
  dueDate: string | null;
  projectName: string;
  /** Solicitação ABERTA deste aprovador (pendente para ele), se houver. */
  myRequestId: string | null;
  /** Versão mais recente que o aprovador enxerga. */
  versionNumber: number | null;
  bucket: PortalBucket;
}

const MATERIAL_TYPES = ["imagem", "carrossel", "video", "pdf"] as const;
const STATUSES = ["rascunho", "aguardando", "alteracao", "aprovado"] as const;

const requestStatus = z.enum(["aberta", "decidida", "cancelada"]);

const rowSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  type: z.enum(MATERIAL_TYPES),
  channel: z.string(),
  status: z.enum(STATUSES),
  due_date: z.string().nullable(),
  projects: z.object({ name: z.string() }).nullable(),
  // As solicitações ficam ligadas à VERSÃO (não há chave estrangeira direta de materials para approval_requests):
  // por isso entram aninhadas em material_versions. A RLS devolve só as solicitações DESTE aprovador.
  material_versions: z.array(
    z.object({
      id: z.uuid(),
      number: z.number(),
      approval_requests: z.array(z.object({ id: z.uuid(), status: requestStatus })),
    }),
  ),
});

export const PORTAL_LIST_SELECT =
  "id, title, type, channel, status, due_date, projects(name), material_versions(id, number, approval_requests(id, status))";

export function bucketOf(status: MaterialStatus, hasOpenRequest: boolean): PortalBucket {
  if (hasOpenRequest) return "pendente";
  if (status === "aprovado") return "aprovado";
  if (status === "aguardando") return "aguardando_outros";
  return "ajustes"; // alteracao, ou rascunho de uma revisão em andamento
}

export async function listPortalMaterials(context: PortalLink): Promise<PortalMaterialItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("materials")
    .select(PORTAL_LIST_SELECT)
    .eq("client_id", context.clientId)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) throw new ReviewLoadError("seus materiais");
  const parsed = z.array(rowSchema).safeParse(data);
  if (!parsed.success) throw new ReviewLoadError("seus materiais");

  return parsed.data.map((row) => {
    const latest = [...row.material_versions].sort((a, b) => b.number - a.number)[0];
    const open = latest?.approval_requests.find((r) => r.status === "aberta");
    return {
      id: row.id,
      title: row.title,
      type: row.type,
      channel: row.channel,
      status: row.status,
      dueDate: row.due_date,
      projectName: row.projects?.name ?? "—",
      myRequestId: open?.id ?? null,
      versionNumber: latest?.number ?? null,
      bucket: bucketOf(row.status, Boolean(open)),
    };
  });
}

export interface PortalMaterialDetail {
  id: string;
  status: MaterialStatus;
  projectName: string;
  /** Solicitação aberta deste aprovador na versão exibida (se existir, ele pode decidir). */
  myRequestId: string | null;
  dueAt: string | null;
  versionId: string;
  bucket: PortalBucket;
  review: ReviewData;
}

const detailSchema = z.object({
  id: z.uuid(),
  status: z.enum(STATUSES),
  projects: z.object({ name: z.string() }).nullable(),
  material_versions: z.array(
    z.object({
      id: z.uuid(),
      number: z.number(),
      approval_requests: z.array(z.object({ id: z.uuid(), status: requestStatus, due_at: z.string().nullable() })),
    }),
  ),
});

export const PORTAL_DETAIL_SELECT = "id, status, projects(name), material_versions(id, number, approval_requests(id, status, due_at))";

/** Detalhe para revisão, ou `null` (material inexistente, de outro cliente ou ainda não enviado: iguais). */
export async function getPortalMaterial(materialId: string, context: PortalLink): Promise<PortalMaterialDetail | null> {
  if (!z.uuid().safeParse(materialId).success) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("materials")
    .select(PORTAL_DETAIL_SELECT)
    .eq("id", materialId)
    .eq("client_id", context.clientId)
    .maybeSingle();
  if (error) throw new ReviewLoadError("o material");
  if (!data) return null;
  const parsed = detailSchema.safeParse(data);
  if (!parsed.success) throw new ReviewLoadError("o material");
  const row = parsed.data;

  const latest = [...row.material_versions].sort((a, b) => b.number - a.number)[0];
  if (!latest) return null;
  const open = latest.approval_requests.find((r) => r.status === "aberta");
  const review = await loadReview(supabase, {
    materialId: row.id,
    versionId: latest.id,
    clientId: context.clientId,
    approverId: context.approverId,
  });
  return {
    id: row.id,
    status: row.status,
    projectName: row.projects?.name ?? "—",
    myRequestId: open?.id ?? null,
    dueAt: open?.due_at ?? null,
    versionId: latest.id,
    bucket: bucketOf(row.status, Boolean(open)),
    review,
  };
}

export interface PortalDecisionItem {
  id: string;
  materialId: string;
  materialTitle: string;
  versionNumber: number;
  decision: "aprovado" | "alteracao";
  via: "portal" | "link";
  at: string;
  note: string;
}

const historySchema = z.object({
  id: z.uuid(),
  material_id: z.uuid(),
  decision: z.enum(["aprovado", "alteracao"]),
  via: z.enum(["portal", "link"]),
  created_at: z.string(),
  note: z.string(),
  material_versions: z.object({ number: z.number(), materials: z.object({ title: z.string() }).nullable() }).nullable(),
});

export const PORTAL_HISTORY_SELECT = "id, material_id, decision, via, created_at, note, material_versions(number, materials(title))";

/** Decisões DESTE aprovador nesta empresa (mais recentes primeiro). */
export async function listMyDecisions(context: PortalLink): Promise<PortalDecisionItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("decisions")
    .select(PORTAL_HISTORY_SELECT)
    .eq("client_id", context.clientId)
    .eq("approver_id", context.approverId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new ReviewLoadError("seu histórico");
  const parsed = z.array(historySchema).safeParse(data);
  if (!parsed.success) throw new ReviewLoadError("seu histórico");
  return parsed.data.map((row) => ({
    id: row.id,
    materialId: row.material_id,
    materialTitle: row.material_versions?.materials?.title ?? "—",
    versionNumber: row.material_versions?.number ?? 0,
    decision: row.decision,
    via: row.via,
    at: row.created_at,
    note: row.note,
  }));
}
