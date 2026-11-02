import "server-only";
import { z } from "zod";
import type { SessionUser } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/env";
import { CURRENT_PORTAL_APPROVER_ID, CURRENT_PORTAL_CLIENT_ID, clients } from "@/lib/mock/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface PortalContext {
  approverId: string;
  clientId: string;
  clientName: string;
}

const rowSchema = z.object({
  id: z.uuid(),
  client_id: z.uuid(),
  client: z.object({ name: z.string() }).nullable(),
});

/**
 * Cliente (empresa) do aprovador logado. A consulta passa pela RLS: o aprovador só enxerga o
 * próprio vínculo. Sem vínculo ativo, devolve null e o portal deve negar o acesso.
 */
export async function getPortalContext(user: SessionUser): Promise<PortalContext | null> {
  if (isDemoMode()) {
    const client = clients.find((c) => c.id === CURRENT_PORTAL_CLIENT_ID)!;
    return { approverId: CURRENT_PORTAL_APPROVER_ID, clientId: client.id, clientName: client.name };
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("approvers")
    .select("id, client_id, client:clients(name)")
    .eq("profile_id", user.id)
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  const parsed = rowSchema.safeParse(data);
  if (!parsed.success || !parsed.data.client) return null;
  return { approverId: parsed.data.id, clientId: parsed.data.client_id, clientName: parsed.data.client.name };
}
