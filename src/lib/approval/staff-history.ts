import "server-only";
import { z } from "zod";
import { DataLoadError } from "@/lib/clients/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Histórico de decisões para a EQUIPE (tela /admin/historico): as decisões mais recentes de todos os clientes
 * da organização. Sempre com o cliente Supabase do usuário, sob a RLS (`decisions_select_staff`, que só libera
 * clientes da própria organização): nada usa a chave secreta e nenhum filtro de dados é aplicado aqui.
 * Os aninhamentos (versão -> material -> cliente) são todos chaves estrangeiras existentes (postgrest-embeds.test).
 */

export const STAFF_HISTORY_SELECT =
  "id, material_id, decision, via, created_at, note, approvers(name), material_versions(number, materials(title, clients(name)))";
export const STAFF_HISTORY_LIMIT = 200;

export interface StaffDecisionItem {
  id: string;
  materialId: string;
  materialTitle: string;
  clientName: string;
  versionNumber: number;
  decision: "aprovado" | "alteracao";
  via: "portal" | "link";
  by: string;
  at: string;
  note: string;
}

const one = <T extends z.ZodType>(schema: T) => z.union([schema, z.array(schema).transform((rows) => rows[0] ?? null), z.null()]);

const rowSchema = z.object({
  id: z.uuid(),
  material_id: z.uuid(),
  decision: z.enum(["aprovado", "alteracao"]),
  via: z.enum(["portal", "link"]),
  created_at: z.string(),
  note: z.string(),
  approvers: one(z.object({ name: z.string() })),
  material_versions: one(
    z.object({
      number: z.number(),
      materials: one(z.object({ title: z.string(), clients: one(z.object({ name: z.string() })) })),
    }),
  ),
});

export async function listStaffDecisions(): Promise<{ items: StaffDecisionItem[]; truncated: boolean }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("decisions")
    .select(STAFF_HISTORY_SELECT)
    .order("created_at", { ascending: false })
    .limit(STAFF_HISTORY_LIMIT);
  if (error) throw new DataLoadError("o histórico de aprovações", error.message);
  const parsed = z.array(rowSchema).safeParse(data);
  if (!parsed.success) throw new DataLoadError("o histórico de aprovações", "resposta inesperada");

  const items = parsed.data.map((row) => ({
    id: row.id,
    materialId: row.material_id,
    materialTitle: row.material_versions?.materials?.title ?? "—",
    clientName: row.material_versions?.materials?.clients?.name ?? "—",
    versionNumber: row.material_versions?.number ?? 0,
    decision: row.decision,
    via: row.via,
    by: row.approvers?.name ?? "—",
    at: row.created_at,
    note: row.note,
  }));
  return { items, truncated: items.length >= STAFF_HISTORY_LIMIT };
}
