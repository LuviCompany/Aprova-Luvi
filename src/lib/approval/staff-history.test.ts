// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Step {
  table: string;
  method: string;
  args: unknown[];
}
let steps: Step[] = [];
let result: { data: unknown; error: { message: string } | null } = { data: [], error: null };

function builderFor(table: string) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      steps.push({ table, method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return builder;
}
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ from: builderFor }) }));

import { STAFF_HISTORY_LIMIT, STAFF_HISTORY_SELECT, listStaffDecisions } from "./staff-history";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n: number, over: Record<string, unknown> = {}) => ({
  id: U(n),
  material_id: U(500 + n),
  decision: "aprovado",
  via: "portal",
  created_at: `2026-11-0${(n % 9) + 1}T12:00:00Z`,
  note: "",
  approvers: { name: "Marina Prado" },
  material_versions: { number: 2, materials: { title: "Carrossel de verão", clients: { name: "Casa Aurora Teste" } } },
  ...over,
});

beforeEach(() => {
  steps = [];
  result = { data: [], error: null };
});

describe("listStaffDecisions", () => {
  it("lê as decisões mais recentes, sob a RLS: sem filtro de dados, com ordem e limite", async () => {
    await listStaffDecisions();
    expect(steps.every((s) => s.table === "decisions")).toBe(true);
    expect(steps.find((s) => s.method === "select")?.args[0]).toBe(STAFF_HISTORY_SELECT);
    expect(steps.find((s) => s.method === "order")?.args).toEqual(["created_at", { ascending: false }]);
    expect(steps.find((s) => s.method === "limit")?.args[0]).toBe(STAFF_HISTORY_LIMIT);
    expect(steps.some((s) => s.method === "eq")).toBe(false);
  });

  it("não lê token, hash, IP nem agente do navegador", () => {
    expect(STAFF_HISTORY_SELECT).not.toMatch(/token|hash|ip_|user_agent/);
  });

  it("mapeia material, cliente, versão, decisão, autor, canal, data e nota", async () => {
    result = { data: [row(1, { decision: "alteracao", via: "link", note: "Trocar a cor do título." })], error: null };
    const { items, truncated } = await listStaffDecisions();
    expect(truncated).toBe(false);
    expect(items).toEqual([
      {
        id: U(1),
        materialId: U(501),
        materialTitle: "Carrossel de verão",
        clientName: "Casa Aurora Teste",
        versionNumber: 2,
        decision: "alteracao",
        via: "link",
        by: "Marina Prado",
        at: "2026-11-02T12:00:00Z",
        note: "Trocar a cor do título.",
      },
    ]);
  });

  it("aceita aninhamento em lista ou nulo e usa '—' quando o dado não vem", async () => {
    result = {
      data: [
        row(1, { approvers: [{ name: "Paulo" }], material_versions: [{ number: 1, materials: [{ title: "Peça", clients: [{ name: "Cliente X" }] }] }] }),
        row(2, { approvers: null, material_versions: null }),
      ],
      error: null,
    };
    const { items } = await listStaffDecisions();
    expect(items[0]).toMatchObject({ by: "Paulo", materialTitle: "Peça", clientName: "Cliente X", versionNumber: 1 });
    expect(items[1]).toMatchObject({ by: "—", materialTitle: "—", clientName: "—", versionNumber: 0 });
  });

  it("lista vazia é válida (a tela mostra o estado vazio)", async () => {
    expect(await listStaffDecisions()).toEqual({ items: [], truncated: false });
  });

  it("avisa quando atinge o limite (há decisões mais antigas fora da tela)", async () => {
    result = { data: Array.from({ length: STAFF_HISTORY_LIMIT }, (_, i) => row(i + 1, { id: `00000000-0000-4000-8000-${String(1000 + i).padStart(12, "0")}` })), error: null };
    expect((await listStaffDecisions()).truncated).toBe(true);
  });

  it("erro do banco e resposta fora do formato viram DataLoadError", async () => {
    result = { data: null, error: { message: "permission denied for table decisions" } };
    await expect(listStaffDecisions()).rejects.toMatchObject({ name: "DataLoadError" });
    result = { data: [{ id: "x" }], error: null };
    await expect(listStaffDecisions()).rejects.toThrow(/Não foi possível carregar o histórico de aprovações/);
  });
});
