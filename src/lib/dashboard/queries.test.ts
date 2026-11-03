// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Step {
  table: string;
  method: string;
  args: unknown[];
}
let steps: Step[] = [];
const results: Record<string, { data: unknown; error: { message: string } | null }> = {};

function builderFor(table: string) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "order", "limit", "eq", "neq"]) {
    builder[method] = (...args: unknown[]) => {
      steps.push({ table, method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(results[table] ?? { data: [], error: null }).then(resolve, reject);
  return builder;
}
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ from: builderFor }) }));

import { DASHBOARD_DECISIONS_SELECT, DASHBOARD_MATERIALS_SELECT, DECISION_LIMIT, MATERIAL_LIMIT, loadDashboard } from "./queries";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const material = (n: number, over: Record<string, unknown> = {}) => ({
  id: U(n), title: `M${n}`, type: "imagem", status: "aguardando", due_date: "2026-11-10", created_at: "2026-11-01T12:00:00Z", clients: { name: "Casa Aurora" }, ...over,
});

beforeEach(() => {
  steps = [];
  for (const key of Object.keys(results)) delete results[key];
  results.materials = { data: [], error: null };
  results.decisions = { data: [], error: null };
  results.clients = { data: [{ id: U(100), name: "A", active: true }, { id: U(101), name: "B", active: false }], error: null };
  results.projects = { data: [{ id: U(200), client_id: U(100), name: "P1", status: "ativo" }, { id: U(201), client_id: U(100), name: "P2", status: "pausado" }], error: null };
});

describe("loadDashboard", () => {
  it("lê materiais e decisões recentes com limite, sob a RLS (sem filtros de dados)", async () => {
    await loadDashboard();
    const m = steps.filter((s) => s.table === "materials");
    expect(m.find((s) => s.method === "select")?.args[0]).toBe(DASHBOARD_MATERIALS_SELECT);
    expect(m.find((s) => s.method === "limit")?.args[0]).toBe(MATERIAL_LIMIT);
    const d = steps.filter((s) => s.table === "decisions");
    expect(d.find((s) => s.method === "select")?.args[0]).toBe(DASHBOARD_DECISIONS_SELECT);
    expect(d.find((s) => s.method === "limit")?.args[0]).toBe(DECISION_LIMIT);
  });

  it("converte as linhas e conta clientes e projetos ativos", async () => {
    results.materials = { data: [material(1), material(2, { clients: null, due_date: null })], error: null };
    results.decisions = {
      data: [
        { id: U(10), material_id: U(1), decision: "aprovado", via: "portal", created_at: "2026-11-03T12:00:00Z", approvers: { name: "Marina" }, approval_requests: { created_at: "2026-11-02T12:00:00Z" } },
        { id: U(11), material_id: U(2), decision: "alteracao", via: "link", created_at: "2026-11-03T13:00:00Z", approvers: null, approval_requests: [] },
      ],
      error: null,
    };
    const data = await loadDashboard();
    expect(data.materials[1]).toMatchObject({ clientName: "—", dueDate: null });
    expect(data.decisions[0]).toMatchObject({ by: "Marina", requestedAt: "2026-11-02T12:00:00Z", via: "portal" });
    expect(data.decisions[1]).toMatchObject({ by: "Aprovador", requestedAt: null, decision: "alteracao" });
    expect(data).toMatchObject({ activeClients: 1, activeProjects: 1, truncated: false });
  });

  it("avisa quando o limite de materiais foi atingido", async () => {
    results.materials = { data: Array.from({ length: MATERIAL_LIMIT }, (_, i) => material(i + 1000)), error: null };
    expect((await loadDashboard()).truncated).toBe(true);
  });

  it("erro do banco e resposta fora do formato viram DataLoadError", async () => {
    results.materials = { data: null, error: { message: "boom" } };
    await expect(loadDashboard()).rejects.toThrow(/Não foi possível carregar os materiais/);
    results.materials = { data: [], error: null };
    results.decisions = { data: null, error: { message: "boom" } };
    await expect(loadDashboard()).rejects.toThrow(/as decisões/);
    results.decisions = { data: [{ id: "x" }], error: null };
    await expect(loadDashboard()).rejects.toThrow(/resposta inesperada/);
  });
});
