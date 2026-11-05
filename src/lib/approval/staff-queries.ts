import "server-only";
import { z } from "zod";
import { DataLoadError } from "@/lib/clients/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Leituras da equipe sobre o ciclo de aprovação de um material (sempre sob a RLS do usuário):
 * os envios (rodadas), quem já respondeu e quem ainda está pendente, e os links de cada aprovador.
 * O hash do token nunca é lido (a coluna nem tem permissão de SELECT).
 */

export type LinkState = "ativo" | "expirado" | "revogado" | "usado";
export type SubmissionSummary = "em_andamento" | "aprovada" | "alteracao" | "cancelada";

export interface StaffRequestItem {
  id: string;
  approverId: string;
  approverName: string;
  approverEmail: string;
  status: "aberta" | "decidida" | "cancelada";
  decision: { kind: "aprovado" | "alteracao"; note: string; via: "portal" | "link"; at: string } | null;
  link: { id: string; state: LinkState; expiresAt: string } | null;
}

export interface StaffSubmission {
  id: string;
  versionId: string;
  versionNumber: number;
  sentAt: string;
  dueAt: string | null;
  message: string;
  summary: SubmissionSummary;
  requests: StaffRequestItem[];
}

export interface ApproverOption {
  id: string;
  name: string;
  email: string;
  jobTitle: string;
}

const oneOrMany = <T extends z.ZodType>(schema: T) =>
  z.union([z.array(schema), schema.transform((row) => [row] as Array<z.infer<T>>), z.null().transform(() => [] as Array<z.infer<T>>)]);

const requestSchema = z.object({
  id: z.uuid(),
  status: z.enum(["aberta", "decidida", "cancelada"]),
  approver_id: z.uuid(),
  submission_id: z.uuid(),
  version_id: z.uuid(),
  due_at: z.string().nullable(),
  message: z.string(),
  created_at: z.string(),
  approvers: z.object({ name: z.string(), email: z.string() }).nullable(),
  material_versions: z.object({ number: z.number() }).nullable(),
  decisions: oneOrMany(
    z.object({ decision: z.enum(["aprovado", "alteracao"]), note: z.string(), via: z.enum(["portal", "link"]), created_at: z.string() }),
  ),
  approval_links: oneOrMany(
    z.object({
      id: z.uuid(),
      expires_at: z.string(),
      revoked_at: z.string().nullable(),
      used_at: z.string().nullable(),
      created_at: z.string(),
    }),
  ),
});

export const REQUEST_SELECT =
  "id, status, approver_id, submission_id, version_id, due_at, message, created_at, approvers(name, email), material_versions(number), decisions(decision, note, via, created_at), approval_links(id, expires_at, revoked_at, used_at, created_at)";

export function linkStateOf(link: { expires_at: string; revoked_at: string | null; used_at: string | null }, now = Date.now()): LinkState {
  if (link.revoked_at) return "revogado";
  if (link.used_at) return "usado";
  if (Date.parse(link.expires_at) <= now) return "expirado";
  return "ativo";
}

export function summarize(requests: Array<Pick<StaffRequestItem, "status" | "decision">>): SubmissionSummary {
  if (requests.some((r) => r.decision?.kind === "alteracao")) return "alteracao";
  if (requests.some((r) => r.status === "aberta")) return "em_andamento";
  if (requests.length > 0 && requests.every((r) => r.decision?.kind === "aprovado")) return "aprovada";
  return "cancelada";
}

/** Envios do material, do mais recente para o mais antigo. */
export async function listSubmissions(materialId: string): Promise<StaffSubmission[]> {
  if (!z.uuid().safeParse(materialId).success) return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("approval_requests")
    .select(REQUEST_SELECT)
    .eq("material_id", materialId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new DataLoadError("os envios para aprovação", error.message);
  const parsed = z.array(requestSchema).safeParse(data);
  if (!parsed.success) throw new DataLoadError("os envios para aprovação", "resposta inesperada");

  const groups = new Map<string, z.infer<typeof requestSchema>[]>();
  for (const row of parsed.data) groups.set(row.submission_id, [...(groups.get(row.submission_id) ?? []), row]);

  const now = Date.now();
  const submissions: StaffSubmission[] = [...groups.entries()].map(([id, rows]) => {
    const requests: StaffRequestItem[] = rows
      .map((row) => {
        const decision = row.decisions[0];
        const link = [...row.approval_links].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
        return {
          id: row.id,
          approverId: row.approver_id,
          approverName: row.approvers?.name ?? "—",
          approverEmail: row.approvers?.email ?? "",
          status: row.status,
          decision: decision ? { kind: decision.decision, note: decision.note, via: decision.via, at: decision.created_at } : null,
          link: link ? { id: link.id, state: linkStateOf(link, now), expiresAt: link.expires_at } : null,
        };
      })
      .sort((a, b) => a.approverName.localeCompare(b.approverName, "pt-BR"));
    const first = rows[0];
    return {
      id,
      versionId: first.version_id,
      versionNumber: first.material_versions?.number ?? 0,
      sentAt: rows.map((r) => r.created_at).sort()[0],
      dueAt: first.due_at,
      message: first.message,
      summary: summarize(requests),
      requests,
    };
  });
  return submissions.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
}

const approverSchema = z.object({ id: z.uuid(), name: z.string(), email: z.string(), job_title: z.string() });

/** Aprovadores ATIVOS do cliente (candidatos ao envio). */
export async function listApproverOptions(clientId: string): Promise<ApproverOption[]> {
  if (!z.uuid().safeParse(clientId).success) return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("approvers")
    .select("id, name, email, job_title")
    .eq("client_id", clientId)
    .eq("active", true)
    .order("name")
    .limit(200);
  if (error) throw new DataLoadError("os aprovadores", error.message);
  const parsed = z.array(approverSchema).safeParse(data);
  if (!parsed.success) throw new DataLoadError("os aprovadores", "resposta inesperada");
  return parsed.data.map((row) => ({ id: row.id, name: row.name, email: row.email, jobTitle: row.job_title }));
}
