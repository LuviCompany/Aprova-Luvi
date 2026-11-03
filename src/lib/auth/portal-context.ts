import "server-only";
import { cookies } from "next/headers";
import { z } from "zod";
import { PORTAL_CLIENT_COOKIE } from "@/lib/auth/portal-cookie";
import { pickPortalContext, sortLinks, type PortalLink, type PortalResolution } from "@/lib/auth/portal-selection";
import type { SessionUser } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/env";
import { CURRENT_PORTAL_APPROVER_ID, CURRENT_PORTAL_CLIENT_ID, clients } from "@/lib/mock/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type { PortalLink, PortalResolution };


const rowSchema = z.object({
  id: z.uuid(),
  client_id: z.uuid(),
  client: z.object({ name: z.string() }).nullable(),
});

/**
 * Vínculos ATIVOS do aprovador logado (um por empresa). A consulta passa pela RLS: o aprovador só
 * enxerga os próprios vínculos, de clientes e aprovadores ativos. Falha de consulta NÃO vira
 * "sem acesso": lança erro (a tela de erro explica e oferece tentar de novo).
 */
export async function listPortalLinks(user: SessionUser): Promise<PortalLink[]> {
  if (isDemoMode()) {
    const client = clients.find((c) => c.id === CURRENT_PORTAL_CLIENT_ID)!;
    return [{ approverId: CURRENT_PORTAL_APPROVER_ID, clientId: client.id, clientName: client.name }];
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("approvers")
    .select("id, client_id, client:clients(name)")
    .eq("profile_id", user.id)
    .eq("active", true)
    .limit(200);
  if (error) throw new Error("Não foi possível carregar suas empresas.");

  const parsed = z.array(rowSchema).safeParse(data);
  if (!parsed.success) throw new Error("Não foi possível carregar suas empresas.");
  return sortLinks(
    parsed.data
      .filter((row) => row.client)
      .map((row) => ({ approverId: row.id, clientId: row.client_id, clientName: row.client!.name })),
  );
}

/** Empresa do portal: a única, a escolhida (se ainda válida) ou "precisa escolher". Nunca "a primeira". */
export async function resolvePortalContext(user: SessionUser): Promise<PortalResolution> {
  const links = await listPortalLinks(user);
  const selected = (await cookies()).get(PORTAL_CLIENT_COOKIE)?.value;
  return pickPortalContext(links, selected);
}
