// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Monta as consultas de leitura contra um Supabase falso e confere filtros, escapes e validação das linhas. */

interface Step {
  method: string;
  args: unknown[];
}
let steps: Step[] = [];
let result: { data: unknown; error: { message: string } | null } = { data: [], error: null };

function builderFor(table: string) {
  steps = [{ method: "from", args: [table] }];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "ilike", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      steps.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ from: builderFor }) }));

import { DataLoadError, listClientOptions, listClients, listProjects } from "./queries";

const UUID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const UUID2 = "4d5e6f70-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const has = (method: string, ...args: unknown[]) =>
  steps.some((s) => s.method === method && args.every((a, i) => s.args[i] === a));

beforeEach(() => {
  result = { data: [], error: null };
});

describe("listClients", () => {
  it("padrão: só ativos, ordenados por nome, contando pendentes só com status aguardando", async () => {
    await listClients({ q: "", status: "ativos" });
    expect(has("eq", "active", true)).toBe(true);
    expect(has("eq", "pending.status", "aguardando")).toBe(true);
    expect(has("order", "name")).toBe(true);
    expect(steps.some((s) => s.method === "ilike")).toBe(false);
  });

  it("arquivados e todos", async () => {
    await listClients({ q: "", status: "arquivados" });
    expect(has("eq", "active", false)).toBe(true);
    await listClients({ q: "", status: "todos" });
    expect(steps.some((s) => s.method === "eq" && s.args[0] === "active")).toBe(false);
  });

  it("a busca escapa curingas do texto digitado", async () => {
    await listClients({ q: "100%_x", status: "todos" });
    expect(has("ilike", "name", "%100\\%\\_x%")).toBe(true);
  });

  it("converte contagens embutidas e aprovadores para o formato da tela", async () => {
    result = {
      data: [
        {
          id: UUID,
          name: "Casa Aurora",
          segment: "",
          initials: "CA",
          active: true,
          projects: [{ count: 3 }],
          pending: [{ count: 1 }],
          approvers: [{ id: UUID2, name: "Marina", email: "m@x.test", job_title: "Marketing", active: true }],
        },
      ],
      error: null,
    };
    expect(await listClients({ q: "", status: "ativos" })).toEqual([
      {
        id: UUID,
        name: "Casa Aurora",
        segment: "",
        initials: "CA",
        active: true,
        projectCount: 3,
        pendingCount: 1,
        approvers: [{ id: UUID2, name: "Marina", email: "m@x.test", jobTitle: "Marketing", active: true }],
      },
    ]);
  });

  it("falha fechado: erro do banco ou resposta inesperada viram DataLoadError", async () => {
    result = { data: null, error: { message: "boom" } };
    await expect(listClients({ q: "", status: "ativos" })).rejects.toBeInstanceOf(DataLoadError);
    result = { data: [{ id: "nao-uuid" }], error: null };
    await expect(listClients({ q: "", status: "ativos" })).rejects.toThrow(/resposta inesperada/);
  });
});

describe("listProjects", () => {
  it("filtra por cliente só quando o valor é UUID", async () => {
    await listProjects({ q: "", status: "todos", clientId: UUID });
    expect(has("eq", "client_id", UUID)).toBe(true);
    await listProjects({ q: "", status: "todos", clientId: "c1" });
    expect(steps.some((s) => s.method === "eq" && s.args[0] === "client_id")).toBe(false);
  });

  it("filtra por status e conta aprovados só com status aprovado", async () => {
    await listProjects({ q: "", status: "pausado", clientId: null });
    expect(has("eq", "status", "pausado")).toBe(true);
    expect(has("eq", "approved.status", "aprovado")).toBe(true);
  });

  it("converte linhas, inclusive projeto sem data e sem materiais", async () => {
    result = {
      data: [
        {
          id: UUID,
          client_id: UUID2,
          name: "Campanha",
          description: "",
          status: "ativo",
          due_date: null,
          clients: { name: "Casa Aurora", active: false },
          materials: [{ count: 0 }],
          approved: [{ count: 0 }],
        },
      ],
      error: null,
    };
    expect(await listProjects({ q: "", status: "todos", clientId: null })).toEqual([
      {
        id: UUID,
        clientId: UUID2,
        clientName: "Casa Aurora",
        clientActive: false,
        name: "Campanha",
        description: "",
        status: "ativo",
        dueDate: null,
        materialCount: 0,
        approvedCount: 0,
      },
    ]);
  });

  it("status desconhecido vindo do banco falha fechado", async () => {
    result = {
      data: [{ id: UUID, client_id: UUID2, name: "x", description: "", status: "arquivado", due_date: null, clients: null, materials: [], approved: [] }],
      error: null,
    };
    await expect(listProjects({ q: "", status: "todos", clientId: null })).rejects.toThrow(/resposta inesperada/);
  });
});

describe("listClientOptions", () => {
  it("devolve id, nome e se está ativo", async () => {
    result = { data: [{ id: UUID, name: "Casa Aurora", active: false }], error: null };
    expect(await listClientOptions()).toEqual([{ id: UUID, name: "Casa Aurora", active: false }]);
  });
});
