// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server Actions de clientes e projetos com um Supabase FALSO. O que se testa aqui é a decisão do
 * servidor (quem pode, o que é validado, o que é enviado ao banco). A RLS de verdade é testada em
 * src/test/db/clients-projects.test.ts.
 */

interface Call {
  table: string;
  op: "select" | "insert" | "update";
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
        eq: (column: string, value: unknown) => {
          call.filters.push(["eq", column, value]);
          return builder;
        },
        ilike: (column: string, value: unknown) => {
          call.filters.push(["ilike", column, value]);
          return builder;
        },
        limit: () => builder,
        maybeSingle: run,
        then: (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) => run().then(resolve, reject),
      };
      return builder;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => fakeSupabase() }));
// A chave secreta ignora a RLS: nenhuma ação comum do painel pode sequer carregar este módulo.
vi.mock("@/lib/supabase/admin", () => {
  throw new Error("as ações do painel não podem usar o cliente de chave secreta");
});

const getSessionState = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionState: () => getSessionState() }));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePath(path) }));

import { saveClientAction, setClientActiveAction } from "@/app/admin/clientes/actions";
import { saveProjectAction } from "@/app/admin/projetos/actions";

const ORG = "0b8f2a6e-5d8c-4a3e-9f57-2f1a3c4d5e6f";
const CLIENT_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const PROJECT_ID = "9b2c6f6a-3f1e-4c53-8d57-6a5c0c0f7a11";
const OTHER_ID = "4d5e6f70-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

const sessionOf = (role: string, id = "11111111-1111-4111-8111-111111111111") => ({
  kind: "ok",
  user: { id, role, organizationId: ORG },
});
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const writes = () => calls.filter((c) => c.op !== "select");
const SAVED = { ...process.env };

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  process.env.SUPABASE_URL = "https://projeto-de-teste.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_" + "x".repeat(30);
  delete process.env.APROVA_DEMO_MODE;
  getSessionState.mockResolvedValue(sessionOf("admin"));
  respond = (call) => {
    if (call.op === "update") return { data: [{ id: call.filters.find((f) => f[1] === "id")?.[2] }], error: null };
    return { data: [], error: null };
  };
});
afterEach(() => {
  process.env = { ...SAVED };
});

describe("autorização no servidor (clientes)", () => {
  const input = form({ name: "Casa Aurora", segment: "Varejo", initials: "" });

  it("designer não cadastra clientes, e nada chega ao banco", async () => {
    getSessionState.mockResolvedValue(sessionOf("designer"));
    expect((await saveClientAction({}, input)).error).toMatch(/permissão/);
    expect((await setClientActiveAction(CLIENT_ID, false)).error).toMatch(/permissão/);
    expect(calls).toHaveLength(0);
  });

  it("aprovador de cliente nunca usa as ações do painel", async () => {
    getSessionState.mockResolvedValue(sessionOf("cliente"));
    expect((await saveClientAction({}, input)).error).toMatch(/permissão/);
    expect(calls).toHaveLength(0);
  });

  it("sem sessão, pede novo login; com serviço fora do ar, avisa a rede (sem dizer que expirou)", async () => {
    getSessionState.mockResolvedValue({ kind: "anonymous" });
    expect((await saveClientAction({}, input)).error).toMatch(/sessão expirou/);
    getSessionState.mockResolvedValue({ kind: "no-access" });
    expect((await saveClientAction({}, input)).error).toMatch(/sessão expirou/);
    getSessionState.mockResolvedValue({ kind: "unavailable" });
    const error = (await saveClientAction({}, input)).error;
    expect(error).toMatch(/serviço de autenticação/);
    expect(error).not.toMatch(/expirou/);
    expect(calls).toHaveLength(0);
  });

  it("na demonstração as ações de escrita são recusadas", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    process.env.APROVA_DEMO_MODE = "true";
    expect((await saveClientAction({}, input)).error).toMatch(/demonstração/);
    expect((await saveProjectAction({}, form({ clientId: CLIENT_ID, name: "Projeto" }))).error).toMatch(/demonstração/);
    expect(calls).toHaveLength(0);
  });

  it("sem Supabase configurado e fora da demonstração, falha fechado", async () => {
    delete process.env.SUPABASE_URL;
    expect((await saveClientAction({}, input)).error).toMatch(/não foi configurado/);
  });
});

describe("saveClientAction", () => {
  it("admin cria o cliente na própria organização, sem enviar nada além do permitido", async () => {
    const result = await saveClientAction({}, form({ name: "  Casa   Aurora ", segment: "Varejo", initials: "" }));
    expect(result).toEqual({ ok: true });
    const [insert] = writes();
    expect(insert).toMatchObject({ table: "clients", op: "insert" });
    expect(insert.payload).toEqual({ organization_id: ORG, name: "Casa Aurora", segment: "Varejo", initials: "CA", active: true });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/clientes");
  });

  it("atendimento também cadastra", async () => {
    getSessionState.mockResolvedValue(sessionOf("atendimento"));
    expect(await saveClientAction({}, form({ name: "Clínica Vida", segment: "", initials: "" }))).toEqual({ ok: true });
  });

  it("não deixa o cliente HTTP escolher a organização ou o status", async () => {
    await saveClientAction(
      {},
      form({ name: "Casa Aurora", segment: "", initials: "", organization_id: "outra", active: "false" }),
    );
    expect(writes()[0].payload).toEqual({ organization_id: ORG, name: "Casa Aurora", segment: "", initials: "CA", active: true });
  });

  it("valida no servidor: erro de campo, nenhuma chamada ao banco", async () => {
    const result = await saveClientAction({}, form({ name: "A", segment: "", initials: "" }));
    expect(result.fieldErrors?.name).toMatch(/mínimo de 2/);
    expect(calls).toHaveLength(0);
  });

  it("recusa nome repetido sem diferenciar maiúsculas (checagem antes de gravar)", async () => {
    respond = (call) => (call.op === "select" ? { data: [{ id: OTHER_ID }], error: null } : { data: [], error: null });
    const result = await saveClientAction({}, form({ name: "casa aurora", segment: "", initials: "" }));
    expect(result.fieldErrors?.name).toMatch(/já existe um cliente/i);
    expect(writes()).toHaveLength(0);
    expect(calls[0].filters).toContainEqual(["ilike", "name", "casa aurora"]);
  });

  it("a busca por nome repetido escapa curingas do texto digitado", async () => {
    await saveClientAction({}, form({ name: "100% Natural_1", segment: "", initials: "" }));
    expect(calls[0].filters).toContainEqual(["ilike", "name", "100\\% Natural\\_1"]);
  });

  it("corrida: se o banco acusar duplicidade (23505), vira erro no campo nome", async () => {
    respond = (call) =>
      call.op === "insert" ? { data: null, error: { code: "23505", message: "duplicate key" } } : { data: [], error: null };
    const result = await saveClientAction({}, form({ name: "Casa Aurora", segment: "", initials: "" }));
    expect(result.fieldErrors?.name).toMatch(/já existe/i);
  });

  it("RLS negando a escrita vira mensagem de permissão, sem texto interno", async () => {
    respond = (call) =>
      call.op === "insert"
        ? { data: null, error: { code: "42501", message: 'new row violates row-level security policy for table "clients"' } }
        : { data: [], error: null };
    const { error } = await saveClientAction({}, form({ name: "Casa Aurora", segment: "", initials: "" }));
    expect(error).toMatch(/permissão/);
    expect(error).not.toMatch(/row-level|clients/);
  });

  it("edita só nome, segmento e iniciais, filtrando pelo id", async () => {
    const result = await saveClientAction({}, form({ id: CLIENT_ID, name: "Casa Aurora Móveis", segment: "Varejo", initials: "cam" }));
    expect(result).toEqual({ ok: true });
    const update = writes()[0];
    expect(update).toMatchObject({ table: "clients", op: "update" });
    expect(update.payload).toEqual({ name: "Casa Aurora Móveis", segment: "Varejo", initials: "CAM" });
    expect(update.filters).toContainEqual(["eq", "id", CLIENT_ID]);
  });

  it("editar o próprio cliente sem mudar o nome não conta como duplicado", async () => {
    respond = (call) => (call.op === "select" ? { data: [{ id: CLIENT_ID }], error: null } : { data: [{ id: CLIENT_ID }], error: null });
    expect(await saveClientAction({}, form({ id: CLIENT_ID, name: "Casa Aurora", segment: "Novo", initials: "" }))).toEqual({ ok: true });
  });

  it("id inexistente (a RLS não devolve a linha) ou malformado", async () => {
    respond = (call) => (call.op === "update" ? { data: [], error: null } : { data: [], error: null });
    expect((await saveClientAction({}, form({ id: CLIENT_ID, name: "Casa Aurora", segment: "", initials: "" }))).error).toMatch(/não encontrado/);
    expect((await saveClientAction({}, form({ id: "1 or 1=1", name: "Casa Aurora", segment: "", initials: "" }))).error).toMatch(/inválido/);
  });
});

describe("setClientActiveAction", () => {
  it("arquiva e reativa mudando só `active`", async () => {
    expect(await setClientActiveAction(CLIENT_ID, false)).toEqual({ ok: true });
    expect(writes()[0].payload).toEqual({ active: false });
    expect(writes()[0].filters).toContainEqual(["eq", "id", CLIENT_ID]);
    calls.length = 0;
    expect(await setClientActiveAction(CLIENT_ID, true)).toEqual({ ok: true });
    expect(writes()[0].payload).toEqual({ active: true });
  });

  it("valida os argumentos vindos do navegador", async () => {
    expect((await setClientActiveAction("nao-uuid", false)).error).toMatch(/inválido/);
    expect((await setClientActiveAction(CLIENT_ID, "false" as unknown as boolean)).error).toMatch(/inválido/);
    expect(calls).toHaveLength(0);
  });

  it("nunca apaga: só existe UPDATE", async () => {
    await setClientActiveAction(CLIENT_ID, false);
    expect(calls.every((c) => c.op === "update")).toBe(true);
  });
});

describe("saveProjectAction", () => {
  const valid = { clientId: CLIENT_ID, name: "Campanha de Verão", description: "Peças", status: "ativo", dueDate: "2026-12-15" };
  const clientRow = (active: boolean) => (call: Call): Result =>
    call.table === "clients" ? { data: { id: CLIENT_ID, active }, error: null } : { data: [], error: null };

  it("qualquer equipe ativa cria projeto (designer inclusive), gravando created_by do servidor", async () => {
    getSessionState.mockResolvedValue(sessionOf("designer", "22222222-2222-4222-8222-222222222222"));
    respond = clientRow(true);
    expect(await saveProjectAction({}, form({ ...valid, created_by: "hack", client_id: "hack" }))).toEqual({ ok: true });
    const insert = writes()[0];
    expect(insert).toMatchObject({ table: "projects", op: "insert" });
    expect(insert.payload).toEqual({
      client_id: CLIENT_ID,
      name: "Campanha de Verão",
      description: "Peças",
      status: "ativo",
      due_date: "2026-12-15",
      created_by: "22222222-2222-4222-8222-222222222222",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/projetos");
  });

  it("aprovador de cliente não cria projeto", async () => {
    getSessionState.mockResolvedValue(sessionOf("cliente"));
    expect((await saveProjectAction({}, form(valid))).error).toMatch(/permissão/);
    expect(calls).toHaveLength(0);
  });

  it("recusa projeto novo em cliente arquivado (a policy não olha clients.active)", async () => {
    respond = clientRow(false);
    const result = await saveProjectAction({}, form(valid));
    expect(result.fieldErrors?.clientId).toMatch(/arquivado/);
    expect(writes()).toHaveLength(0);
  });

  it("cliente inexistente ou de outra organização (RLS esconde a linha)", async () => {
    respond = () => ({ data: null, error: null });
    expect((await saveProjectAction({}, form(valid))).fieldErrors?.clientId).toMatch(/não encontrado/);
    expect(writes()).toHaveLength(0);
  });

  it("valida no servidor antes de consultar o banco", async () => {
    const result = await saveProjectAction({}, form({ ...valid, name: "", dueDate: "2026-02-31" }));
    expect(result.fieldErrors).toMatchObject({ name: expect.any(String), dueDate: expect.any(String) });
    expect(calls).toHaveLength(0);
  });

  it("data de entrega vazia grava null", async () => {
    respond = clientRow(true);
    await saveProjectAction({}, form({ ...valid, dueDate: "" }));
    expect((writes()[0].payload as { due_date: unknown }).due_date).toBeNull();
  });

  it("edição muda só nome, descrição, status e data, e nunca o cliente", async () => {
    const result = await saveProjectAction({}, form({ ...valid, id: PROJECT_ID, clientId: OTHER_ID, status: "pausado" }));
    expect(result).toEqual({ ok: true });
    const update = writes()[0];
    expect(update).toMatchObject({ table: "projects", op: "update" });
    expect(update.payload).toEqual({ name: "Campanha de Verão", description: "Peças", status: "pausado", due_date: "2026-12-15" });
    expect(update.filters).toContainEqual(["eq", "id", PROJECT_ID]);
    // sem consulta ao cliente na edição
    expect(calls.some((c) => c.table === "clients")).toBe(false);
  });

  it("projeto inexistente na edição", async () => {
    respond = () => ({ data: [], error: null });
    expect((await saveProjectAction({}, form({ ...valid, id: PROJECT_ID }))).error).toMatch(/não encontrado/);
  });
});
