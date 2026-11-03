// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Monta as consultas de materiais contra um Supabase falso e confere filtros, paginação e validação das linhas. */

interface Step {
  method: string;
  args: unknown[];
}
let steps: Step[] = [];
let result: { data: unknown; error: { message: string } | null; count?: number | null } = { data: [], error: null };

function builderFor(table: string) {
  steps = [{ method: "from", args: [table] }];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "ilike", "order", "limit", "range"]) {
    builder[method] = (...args: unknown[]) => {
      steps.push({ method, args });
      return builder;
    };
  }
  builder.maybeSingle = () => {
    steps.push({ method: "maybeSingle", args: [] });
    return Promise.resolve(result);
  };
  builder.then = (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ from: builderFor }) }));

import { getMaterial, listMaterialProjectOptions, listMaterials } from "./queries";
import { MATERIAL_DETAIL_SELECT, MATERIAL_LIST_SELECT } from "./selects";
import type { MaterialFilters } from "./schema";

const UUID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const UUID2 = "4d5e6f70-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const UUID3 = "9b2c6f6a-3f1e-4c53-8d57-6a5c0c0f7a11";
const has = (method: string, ...args: unknown[]) =>
  steps.some((s) => s.method === method && args.every((a, i) => s.args[i] === a));
const none = (method: string, first?: unknown) =>
  !steps.some((s) => s.method === method && (first === undefined || s.args[0] === first));

const FILTERS: MaterialFilters = { q: "", status: "todos", type: "todos", clientId: null, projectId: null, page: 1 };

const row = (overrides: Record<string, unknown> = {}) => ({
  id: UUID,
  client_id: UUID2,
  project_id: UUID3,
  title: "Campanha",
  type: "imagem",
  aspect_ratio: "4:5",
  channel: "Instagram Feed",
  status: "rascunho",
  publish_date: "2026-12-01",
  due_date: null,
  created_at: "2026-11-03T12:00:00Z",
  clients: { name: "Casa Aurora", active: true },
  projects: { name: "Verão", status: "ativo" },
  versions: [{ count: 0 }],
  ...overrides,
});

beforeEach(() => {
  result = { data: [], error: null, count: 0 };
});

describe("listMaterials", () => {
  it("padrão: mais recentes primeiro, página 1 (0 a 19), contagem exata e sem filtros", async () => {
    await listMaterials(FILTERS);
    expect(has("from", "materials")).toBe(true);
    expect(has("select", MATERIAL_LIST_SELECT)).toBe(true);
    expect(steps.find((s) => s.method === "select")?.args[1]).toEqual({ count: "exact" });
    expect(steps.some((s) => s.method === "order" && s.args[0] === "created_at" && (s.args[1] as { ascending: boolean }).ascending === false)).toBe(true);
    expect(has("range", 0, 19)).toBe(true);
    for (const method of ["eq", "ilike"]) expect(none(method)).toBe(true);
  });

  it("aplica cliente, projeto, status e tipo; busca escapa curingas", async () => {
    await listMaterials({ ...FILTERS, q: "100%_x", status: "aprovado", type: "pdf", clientId: UUID, projectId: UUID2 });
    expect(has("eq", "client_id", UUID)).toBe(true);
    expect(has("eq", "project_id", UUID2)).toBe(true);
    expect(has("eq", "status", "aprovado")).toBe(true);
    expect(has("eq", "type", "pdf")).toBe(true);
    expect(has("ilike", "title", "%100\\%\\_x%")).toBe(true);
  });

  it("id de cliente ou projeto que não é UUID nunca vira filtro", async () => {
    await listMaterials({ ...FILTERS, clientId: "c1", projectId: "p1" });
    expect(none("eq", "client_id")).toBe(true);
    expect(none("eq", "project_id")).toBe(true);
  });

  it("pagina de 20 em 20 e calcula o total de páginas", async () => {
    result = { data: [row()], error: null, count: 45 };
    const page = await listMaterials({ ...FILTERS, page: 3 });
    expect(has("range", 40, 59)).toBe(true);
    expect(page).toMatchObject({ total: 45, page: 3, pageCount: 3 });
  });

  it("converte a linha para o formato da tela", async () => {
    result = { data: [row({ versions: [{ count: 2 }] })], error: null, count: 1 };
    const { items } = await listMaterials(FILTERS);
    expect(items[0]).toEqual({
      id: UUID,
      clientId: UUID2,
      clientName: "Casa Aurora",
      projectId: UUID3,
      projectName: "Verão",
      title: "Campanha",
      type: "imagem",
      aspectRatio: "4:5",
      channel: "Instagram Feed",
      status: "rascunho",
      publishDate: "2026-12-01",
      dueDate: null,
      versionCount: 2,
    });
  });

  it("lista vazia tem 1 página", async () => {
    expect(await listMaterials(FILTERS)).toMatchObject({ items: [], total: 0, pageCount: 1 });
  });

  it("erro do banco e resposta fora do formato viram DataLoadError sem repassar a resposta", async () => {
    result = { data: null, error: { message: "boom" }, count: null };
    await expect(listMaterials(FILTERS)).rejects.toThrow(/Não foi possível carregar os materiais/);
    result = { data: [row({ type: "gif" })], error: null, count: 1 };
    await expect(listMaterials(FILTERS)).rejects.toThrow(/resposta inesperada/);
  });
});

describe("getMaterial", () => {
  it("id que não é UUID responde nulo sem consultar o banco", async () => {
    steps = [];
    expect(await getMaterial("nao-e-uuid")).toBeNull();
    expect(steps).toHaveLength(0);
  });

  it("material que a RLS não mostra (ou não existe) responde nulo", async () => {
    result = { data: null, error: null };
    expect(await getMaterial(UUID)).toBeNull();
    expect(has("eq", "id", UUID)).toBe(true);
    expect(has("select", MATERIAL_DETAIL_SELECT)).toBe(true);
  });

  it("devolve o detalhe com legenda e descrição", async () => {
    result = {
      data: row({ description: "Notas internas", caption: "Legenda\ncom linhas", updated_at: "2026-11-04T10:00:00Z" }),
      error: null,
    };
    expect(await getMaterial(UUID)).toMatchObject({
      id: UUID,
      description: "Notas internas",
      caption: "Legenda\ncom linhas",
      clientActive: true,
      projectStatus: "ativo",
      updatedAt: "2026-11-04T10:00:00Z",
    });
  });
});

describe("listMaterialProjectOptions", () => {
  it("lê os projetos (com status) para os seletores", async () => {
    result = { data: [{ id: UUID, client_id: UUID2, name: "Verão", status: "concluido" }], error: null };
    expect(await listMaterialProjectOptions()).toEqual([{ id: UUID, clientId: UUID2, name: "Verão", status: "concluido" }]);
    expect(has("order", "name")).toBe(true);
  });
});
