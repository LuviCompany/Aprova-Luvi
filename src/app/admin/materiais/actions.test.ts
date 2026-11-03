// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server Actions de materiais com um Supabase FALSO. O que se testa aqui é a decisão do servidor
 * (quem pode, o que é validado, o que é enviado ao banco). A RLS e as travas de verdade estão em
 * src/test/db/materials-b.test.ts.
 */

interface Call {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  payload?: unknown;
  filters: Array<[string, string, unknown]>;
}
type Result = { data: unknown; error: { code?: string; message?: string } | null };

const calls: Call[] = [];
let respond: (call: Call) => Result;

function fakeSupabase() {
  return {
    from(table: string) {
      const call: Call = { table, op: "select", filters: [] };
      const run = () => {
        calls.push(call);
        return Promise.resolve(respond(call));
      };
      const builder: Record<string, unknown> = {
        select: () => builder,
        insert: (payload: unknown) => {
          call.op = "insert";
          call.payload = payload;
          return builder;
        },
        update: (payload: unknown) => {
          call.op = "update";
          call.payload = payload;
          return builder;
        },
        delete: () => {
          call.op = "delete";
          return builder;
        },
        eq: (column: string, value: unknown) => {
          call.filters.push(["eq", column, value]);
          return builder;
        },
        maybeSingle: run,
        then: (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) => run().then(resolve, reject),
      };
      return builder;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => fakeSupabase() }));
vi.mock("@/lib/supabase/admin", () => {
  throw new Error("as ações do painel não podem usar o cliente de chave secreta");
});

const getSessionState = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionState: () => getSessionState() }));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

import { deleteMaterialAction, saveMaterialAction } from "@/app/admin/materiais/actions";

const ORG = "0b8f2a6e-5d8c-4a3e-9f57-2f1a3c4d5e6f";
const USER = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const PROJECT_ID = "9b2c6f6a-3f1e-4c53-8d57-6a5c0c0f7a11";
const MATERIAL_ID = "4d5e6f70-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const OTHER_ID = "5e6f7081-2b3c-4d4e-8f90-1b2c3d4e5f60";

const sessionOf = (role: string) => ({ kind: "ok", user: { id: USER, role, organizationId: ORG } });
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const writes = () => calls.filter((c) => c.op !== "select");
const SAVED = { ...process.env };

const createForm = (overrides: Record<string, string> = {}) =>
  form({
    clientId: CLIENT_ID,
    projectId: PROJECT_ID,
    type: "carrossel",
    title: "  Campanha   de verão ",
    description: " Notas internas ",
    caption: "Legenda\r\ncom linhas",
    aspectRatio: "4:5",
    channel: "Instagram Feed",
    publishDate: "2026-12-01",
    dueDate: "2026-11-20",
    ...overrides,
  });

const CURRENT = {
  status: "rascunho",
  title: "Campanha de verão",
  description: "Notas internas",
  caption: "Legenda\ncom linhas",
  channel: "Instagram Feed",
  aspect_ratio: "4:5",
};
const editForm = (overrides: Record<string, string> = {}) => createForm({ id: MATERIAL_ID, clientId: "", projectId: "", type: "", ...overrides });

/** Estado do banco falso: cliente ativo, projeto ativo do cliente, material em rascunho. */
let state: { client: unknown; project: unknown; material: unknown };

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  process.env.SUPABASE_URL = "https://projeto-de-teste.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_" + "x".repeat(30);
  delete process.env.APROVA_DEMO_MODE;
  getSessionState.mockResolvedValue(sessionOf("designer"));
  state = {
    client: { id: CLIENT_ID, active: true },
    project: { id: PROJECT_ID, client_id: CLIENT_ID, status: "ativo" },
    material: { ...CURRENT },
  };
  respond = (call) => {
    if (call.op === "select") {
      if (call.table === "clients") return { data: state.client, error: null };
      if (call.table === "projects") return { data: state.project, error: null };
      return { data: state.material, error: null };
    }
    if (call.op === "update" || call.op === "delete") return { data: [{ id: MATERIAL_ID }], error: null };
    return { data: null, error: null };
  };
});
afterEach(() => {
  process.env = { ...SAVED };
});

describe("autorização no servidor", () => {
  it("designer, atendimento e admin podem cadastrar (a RLS permite à equipe)", async () => {
    for (const role of ["designer", "atendimento", "admin"]) {
      calls.length = 0;
      getSessionState.mockResolvedValue(sessionOf(role));
      expect(await saveMaterialAction({}, createForm()), role).toEqual({ ok: true });
      expect(writes()).toHaveLength(1);
    }
  });

  it("aprovador de cliente e sessões inválidas nunca chegam ao banco", async () => {
    getSessionState.mockResolvedValue(sessionOf("cliente"));
    expect((await saveMaterialAction({}, createForm())).error).toMatch(/permissão/);
    expect((await deleteMaterialAction(MATERIAL_ID)).error).toMatch(/permissão/);
    getSessionState.mockResolvedValue({ kind: "anonymous" });
    expect((await saveMaterialAction({}, createForm())).error).toMatch(/sessão expirou/);
    getSessionState.mockResolvedValue({ kind: "unavailable" });
    expect((await deleteMaterialAction(MATERIAL_ID)).error).toMatch(/serviço de autenticação/);
    expect(calls).toHaveLength(0);
  });

  it("na demonstração as ações ficam indisponíveis", async () => {
    process.env.APROVA_DEMO_MODE = "true";
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    expect((await saveMaterialAction({}, createForm())).error).toMatch(/demonstração/);
    expect(calls).toHaveLength(0);
  });
});

describe("cadastro", () => {
  it("grava os campos normalizados; created_by vem da sessão, nunca do formulário; nada de organização nem status", async () => {
    const forged = createForm({ created_by: OTHER_ID, status: "aprovado", organization_id: OTHER_ID, createdBy: OTHER_ID });
    expect(await saveMaterialAction({}, forged)).toEqual({ ok: true });
    const insert = writes()[0];
    expect(insert).toMatchObject({ table: "materials", op: "insert" });
    expect(insert.payload).toEqual({
      client_id: CLIENT_ID,
      project_id: PROJECT_ID,
      title: "Campanha de verão",
      description: "Notas internas",
      caption: "Legenda\ncom linhas",
      type: "carrossel",
      aspect_ratio: "4:5",
      channel: "Instagram Feed",
      publish_date: "2026-12-01",
      due_date: "2026-11-20",
      created_by: USER,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/materiais");
  });

  it("proporção e datas vazias viram nulo", async () => {
    await saveMaterialAction({}, createForm({ aspectRatio: "", publishDate: "", dueDate: "" }));
    expect(writes()[0].payload).toMatchObject({ aspect_ratio: null, publish_date: null, due_date: null });
  });

  it("dados inválidos voltam por campo, sem consultar nem gravar", async () => {
    const result = await saveMaterialAction({}, createForm({ title: "A", type: "gif", aspectRatio: "2:3", publishDate: "2026-02-31" }));
    expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["aspectRatio", "publishDate", "title", "type"]);
    expect(calls).toHaveLength(0);
  });

  it("cliente arquivado: recusa no servidor, sem gravar", async () => {
    state.client = { id: CLIENT_ID, active: false };
    const result = await saveMaterialAction({}, createForm());
    expect(result.fieldErrors?.clientId).toMatch(/arquivado/);
    expect(writes()).toHaveLength(0);
  });

  it("cliente inexistente ou invisível para a RLS", async () => {
    state.client = null;
    expect((await saveMaterialAction({}, createForm())).fieldErrors?.clientId).toMatch(/não encontrado/);
    expect(writes()).toHaveLength(0);
  });

  it("projeto de outro cliente, inexistente ou concluído é recusado (regra do servidor; o banco só garante o vínculo cliente-projeto)", async () => {
    state.project = { id: PROJECT_ID, client_id: OTHER_ID, status: "ativo" };
    expect((await saveMaterialAction({}, createForm())).fieldErrors?.projectId).toMatch(/neste cliente/);
    state.project = null;
    expect((await saveMaterialAction({}, createForm())).fieldErrors?.projectId).toMatch(/neste cliente/);
    state.project = { id: PROJECT_ID, client_id: CLIENT_ID, status: "concluido" };
    expect((await saveMaterialAction({}, createForm())).fieldErrors?.projectId).toMatch(/concluído/);
    state.project = { id: PROJECT_ID, client_id: CLIENT_ID, status: "pausado" };
    expect(await saveMaterialAction({}, createForm())).toEqual({ ok: true });
    expect(writes()).toHaveLength(1);
  });

  it("erro do banco vira mensagem amigável, sem vazar o texto interno", async () => {
    respond = (call) =>
      call.op === "insert"
        ? { data: null, error: { code: "23514", message: 'cliente arquivado: reative o cliente antes de cadastrar em materials' } }
        : { data: call.table === "clients" ? state.client : state.project, error: null };
    const result = await saveMaterialAction({}, createForm());
    expect(result.error).toBe("Este cliente está arquivado. Reative-o antes de cadastrar.");
    expect(result.error).not.toMatch(/materials/);
  });

  it("falha de rede ao gravar avisa a rede", async () => {
    respond = (call) =>
      call.op === "insert" ? { data: null, error: { message: "fetch failed" } } : { data: call.table === "clients" ? state.client : state.project, error: null };
    expect((await saveMaterialAction({}, createForm())).error).toMatch(/Não foi possível falar com o serviço/);
  });
});

describe("edição", () => {
  it("em rascunho, envia todo o conteúdo e as datas; cliente, projeto, tipo e status nunca vão no UPDATE", async () => {
    expect(await saveMaterialAction({}, editForm({ title: "Novo título", caption: "Nova legenda", dueDate: "", publishDate: "2026-12-10" }))).toEqual({ ok: true });
    const update = writes()[0];
    expect(update).toMatchObject({ table: "materials", op: "update" });
    expect(update.filters).toContainEqual(["eq", "id", MATERIAL_ID]);
    expect(update.payload).toEqual({
      title: "Novo título",
      description: "Notas internas",
      caption: "Nova legenda",
      channel: "Instagram Feed",
      aspect_ratio: "4:5",
      publish_date: "2026-12-10",
      due_date: null,
    });
    for (const forbidden of ["client_id", "project_id", "type", "status", "created_by"]) {
      expect(Object.keys(update.payload as object)).not.toContain(forbidden);
    }
  });

  it("material enviado com o MESMO conteúdo: só as datas vão no UPDATE", async () => {
    for (const status of ["aguardando", "alteracao", "aprovado"]) {
      calls.length = 0;
      state.material = { ...CURRENT, status };
      expect(await saveMaterialAction({}, editForm({ publishDate: "2026-12-20" })), status).toEqual({ ok: true });
      expect(writes()[0].payload).toEqual({ publish_date: "2026-12-20", due_date: "2026-11-20" });
    }
  });

  it("material enviado com conteúdo diferente: recusa no servidor, sem gravar", async () => {
    state.material = { ...CURRENT, status: "aprovado" };
    const changes: Array<Record<string, string>> = [{ title: "Outro" }, { caption: "Outra" }, { description: "x" }, { channel: "TikTok" }, { aspectRatio: "9:16" }];
    for (const change of changes) {
      const result = await saveMaterialAction({}, editForm(change));
      expect(result.error, JSON.stringify(change)).toMatch(/já foi enviado para aprovação/);
    }
    expect(writes()).toHaveLength(0);
  });

  it("material inexistente ou invisível; id malformado", async () => {
    state.material = null;
    expect((await saveMaterialAction({}, editForm())).error).toMatch(/não encontrado/);
    expect((await saveMaterialAction({}, editForm({ id: "abc" }))).error).toBe("Material inválido.");
    expect(writes()).toHaveLength(0);
  });

  it("UPDATE sem linhas afetadas (RLS) não finge sucesso", async () => {
    respond = (call) => (call.op === "update" ? { data: [], error: null } : { data: state.material, error: null });
    expect((await saveMaterialAction({}, editForm())).error).toMatch(/não encontrado/);
  });

  it("a trava do banco, se for atingida, vira mensagem amigável", async () => {
    respond = (call) =>
      call.op === "update"
        ? { data: null, error: { code: "23514", message: "material já enviado para aprovação: o conteúdo só muda numa nova revisão" } }
        : { data: state.material, error: null };
    expect((await saveMaterialAction({}, editForm())).error).toMatch(/já foi enviado para aprovação/);
  });
});

describe("exclusão controlada", () => {
  it("exclui rascunho, filtrando pelo id, e atualiza as telas", async () => {
    expect(await deleteMaterialAction(MATERIAL_ID)).toEqual({ ok: true });
    const del = writes()[0];
    expect(del).toMatchObject({ table: "materials", op: "delete" });
    expect(del.filters).toEqual([["eq", "id", MATERIAL_ID]]);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/materiais");
  });

  it("só rascunho: material enviado, com alteração pedida ou aprovado nem chega ao DELETE", async () => {
    for (const status of ["aguardando", "alteracao", "aprovado"]) {
      state.material = { status };
      expect((await deleteMaterialAction(MATERIAL_ID)).error, status).toMatch(/Só rascunhos/);
    }
    expect(writes()).toHaveLength(0);
  });

  it("rascunho com versão: a chave estrangeira recusa e a mensagem explica", async () => {
    respond = (call) =>
      call.op === "delete" ? { data: null, error: { code: "23503", message: "violates foreign key constraint" } } : { data: { id: MATERIAL_ID, status: "rascunho" }, error: null };
    const result = await deleteMaterialAction(MATERIAL_ID);
    expect(result.error).toBe("Este material já tem versões e não pode ser excluído.");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("DELETE sem linhas (RLS) não finge sucesso; id inválido ou inexistente", async () => {
    respond = (call) => (call.op === "delete" ? { data: [], error: null } : { data: { id: MATERIAL_ID, status: "rascunho" }, error: null });
    expect((await deleteMaterialAction(MATERIAL_ID)).error).toMatch(/só rascunhos vazios/);
    expect((await deleteMaterialAction("abc")).error).toBe("Material inválido.");
    state.material = null;
    respond = () => ({ data: null, error: null });
    expect((await deleteMaterialAction(MATERIAL_ID)).error).toMatch(/não encontrado/);
  });
});
