import "server-only";
import { z } from "zod";
import { listProjects, DataLoadError, type ProjectListItem } from "@/lib/clients/queries";
import { APPROVER_SELECT, CLIENT_DETAIL_SELECT, INVITE_SELECT, OTHER_APPROVER_SELECT } from "@/lib/clients/selects";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { accessStatus, type AccessStatus, type InviteStatusValue } from "./schema";
import { alsoApprovesFor, buildLinkCandidates, type LinkCandidate, type OtherApproverRow } from "./people";

/**
 * Leitura do detalhe de um cliente com seus aprovadores. Sempre com o cliente Supabase DO USUÁRIO
 * (RLS): quem não pode ver o cliente recebe `null`, igual a um cliente que não existe.
 */

export interface ApproverItem {
  id: string;
  name: string;
  email: string;
  jobTitle: string;
  active: boolean;
  hasLogin: boolean;
  access: AccessStatus;
  /** Convite em aberto (preparado ou enviado), se houver. */
  inviteId: string | null;
  /** Outros clientes em que a mesma pessoa aprova (vínculos ativos). */
  alsoApprovesFor: string[];
}

export interface ClientDetail {
  client: { id: string; name: string; segment: string; initials: string; active: boolean };
  approvers: ApproverItem[];
  linkCandidates: LinkCandidate[];
  projects: ProjectListItem[];
}

const LIMIT = 1000;

const clientSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  segment: z.string(),
  initials: z.string(),
  active: z.boolean(),
});

const approverSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  job_title: z.string(),
  active: z.boolean(),
  profile_id: z.uuid().nullable(),
});

const otherSchema = approverSchema.extend({
  client_id: z.uuid(),
  clients: z.object({ name: z.string() }).nullable(),
});

const inviteSchema = z.object({
  id: z.uuid(),
  approver_id: z.uuid(),
  status: z.enum(["preparado", "enviado"]),
});

export async function getClientDetail(clientId: string): Promise<ClientDetail | null> {
  const supabase = await createSupabaseServerClient();

  const clientResult = await supabase.from("clients").select(CLIENT_DETAIL_SELECT).eq("id", clientId).maybeSingle();
  if (clientResult.error) throw new DataLoadError("o cliente", clientResult.error.message);
  if (!clientResult.data) return null;
  const client = clientSchema.safeParse(clientResult.data);
  if (!client.success) throw new DataLoadError("o cliente", "resposta inesperada");

  const [approversResult, invitesResult, othersResult, projects] = await Promise.all([
    supabase.from("approvers").select(APPROVER_SELECT).eq("client_id", clientId).order("name").limit(LIMIT),
    supabase
      .from("approver_invites")
      .select(INVITE_SELECT)
      .eq("client_id", clientId)
      .in("status", ["preparado", "enviado"]),
    supabase.from("approvers").select(OTHER_APPROVER_SELECT).neq("client_id", clientId).order("name").limit(LIMIT),
    listProjects({ q: "", status: "todos", clientId }),
  ]);
  for (const result of [approversResult, othersResult]) {
    if (result.error) throw new DataLoadError("os aprovadores", result.error.message);
  }
  // Ordem de implantação: enquanto a migration dos convites (M3) não foi aplicada no projeto, a tabela
  // não existe (PGRST205) e a tela funciona sem convites. Qualquer outro erro continua falhando fechado.
  if (invitesResult.error && invitesResult.error.code !== "PGRST205") {
    throw new DataLoadError("os convites", invitesResult.error.message);
  }
  const approvers = z.array(approverSchema).safeParse(approversResult.data);
  const invites = z.array(inviteSchema).safeParse(invitesResult.error ? [] : invitesResult.data);
  const others = z.array(otherSchema).safeParse(othersResult.data);
  if (!approvers.success || !invites.success || !others.success) {
    throw new DataLoadError("os aprovadores", "resposta inesperada");
  }

  const otherRows: OtherApproverRow[] = others.data.map((row) => ({
    id: row.id,
    clientId: row.client_id,
    clientName: row.clients?.name ?? "—",
    email: row.email,
    name: row.name,
    jobTitle: row.job_title,
    active: row.active,
    hasLogin: row.profile_id !== null,
  }));
  const emails = approvers.data.map((a) => a.email);
  const also = alsoApprovesFor(otherRows, emails);
  const inviteByApprover = new Map(invites.data.map((i) => [i.approver_id, i]));

  return {
    client: client.data,
    approvers: approvers.data.map((a) => {
      const invite = inviteByApprover.get(a.id) ?? null;
      return {
        id: a.id,
        name: a.name,
        email: a.email,
        jobTitle: a.job_title,
        active: a.active,
        hasLogin: a.profile_id !== null,
        access: accessStatus(a.profile_id !== null, (invite?.status ?? null) as InviteStatusValue | null),
        inviteId: invite?.id ?? null,
        alsoApprovesFor: also.get(a.email.trim().toLowerCase()) ?? [],
      };
    }),
    // Só dá para vincular a um cliente ATIVO (o banco recusa em arquivado).
    linkCandidates: client.data.active ? buildLinkCandidates(otherRows, emails) : [],
    projects,
  };
}
