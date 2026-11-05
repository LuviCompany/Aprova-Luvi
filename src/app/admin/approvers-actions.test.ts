// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server Actions de aprovadores com um Supabase FALSO. Testa a decisão do servidor (quem pode, o que
 * é validado, o que é enviado ao banco e quais funções são chamadas). A RLS e as funções de verdade
 * são testadas em src/test/db/approvers-a2.test.ts.
 */

interface Call {
  kind: "query" | "rpc";
  table: string;
  op: "select" | "insert" | "update" | "rpc";
  payload?: unknown;
  filters: Array<[string, string, unknown]>;
}
type Result = { data: unknown; error: { code?: string; message?: string } | null };

const calls: Call[] = [];
let respond: (call: Call) => Result;

function fakeSupabase() {
  return {
    from(table: string) {
      const call: Call = { kind: "query", table, op: "select", filters: [] };
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
        maybeSingle: run,
        then: (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) => run().then(resolve, reject),
      };
      return builder;
    },
    rpc(fn: string, args: unknown) {
      const call: Call = { kind: "rpc", table: fn, op: "rpc", payload: args, filters: [] };
      calls.push(call);
      return Promise.resolve(respond(call));
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => fakeSupabase() }));
vi.mock("@/lib/supabase/admin", () => {
  throw new Error("as ações do painel não podem usar o cliente de chave secreta");
});
const sendApproverInvite = vi.fn();
// O serviço de convite usa a chave secreta (por isso fica fora do painel); aqui só se prova o que a AÇÃO decide.
vi.mock("@/lib/invites/service", () => ({ sendApproverInvite: (...args: unknown[]) => sendApproverInvite(...args) }));
const getSessionState = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionState: () => getSessionState() }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

import {
  cancelInviteAction,
  linkApproverAction,
  prepareInviteAction,
  saveApproverAction,
  sendInviteAction,
  setApproverActiveAction,
} from "@/app/admin/clientes/[id]/actions";

const ORG = "0b8f2a6e-5d8c-4a3e-9f57-2f1a3c4d5e6f";
const CLIENT = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const OTHER = "4d5e6f70-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const APPROVER = "9b2c6f6a-3f1e-4c53-8d57-6a5c0c0f7a11";
const INVITE = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d";

const session = (role: string) => ({ kind: "ok", user: { id: "11111111-1111-4111-8111-111111111111", role, organizationId: ORG } });
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const writes = () => calls.filter((c) => c.op === "insert" || c.op === "update" || c.op === "rpc");
const SAVED = { ...process.env };

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  process.env.SUPABASE_URL = "https://projeto-de-teste.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_" + "x".repeat(30);
  delete process.env.APROVA_DEMO_MODE;
  getSessionState.mockResolvedValue(session("admin"));
  respond = (call) => {
    if (call.op === "update") return { data: [{ id: call.filters.find((f) => f[1] === "id")?.[2] }], error: null };
    if (call.table === "clients") return { data: { id: CLIENT, active: true }, error: null };
    return { data: [], error: null };
  };
});
afterEach(() => {
  process.env = { ...SAVED };
});

describe("autorização no servidor (aprovadores)", () => {
  const novo = form({ clientId: CLIENT, name: "Marina Prado", email: "marina@x.com", jobTitle: "" });

  it("designer, aprovador de cliente e sessão ausente não gerenciam aprovadores, e nada chega ao banco", async () => {
    for (const papel of ["designer", "cliente"]) {
      getSessionState.mockResolvedValue(session(papel));
      expect((await saveApproverAction({}, novo)).error, papel).toMatch(/permissão/);
      expect((await setApproverActiveAction(APPROVER, false)).error, papel).toMatch(/permissão/);
      expect((await linkApproverAction(APPROVER, CLIENT)).error, papel).toMatch(/permissão/);
      expect((await prepareInviteAction(APPROVER)).error, papel).toMatch(/permissão/);
      expect((await cancelInviteAction(INVITE)).error, papel).toMatch(/permissão/);
    }
    getSessionState.mockResolvedValue({ kind: "anonymous" });
    expect((await saveApproverAction({}, novo)).error).toMatch(/sessão expirou/);
    getSessionState.mockResolvedValue({ kind: "unavailable" });
    expect((await saveApproverAction({}, novo)).error).toMatch(/serviço de autenticação/);
    expect(calls).toHaveLength(0);
  });

  it("na demonstração todas as ações de escrita são recusadas", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    process.env.APROVA_DEMO_MODE = "true";
    expect((await saveApproverAction({}, novo)).error).toMatch(/demonstração/);
    expect((await linkApproverAction(APPROVER, CLIENT)).error).toMatch(/demonstração/);
    expect(calls).toHaveLength(0);
  });
});

describe("saveApproverAction", () => {
  it("admin e atendimento cadastram: e-mail normalizado, ativo, SEM profile_id", async () => {
    for (const papel of ["admin", "atendimento"]) {
      calls.length = 0;
      getSessionState.mockResolvedValue(session(papel));
      const result = await saveApproverAction({}, form({ clientId: CLIENT, name: "  Marina  Prado ", email: " Marina@X.COM ", jobTitle: "Marketing", profile_id: "hack", active: "false" }));
      expect(result, papel).toEqual({ ok: true });
      const insert = writes()[0];
      expect(insert).toMatchObject({ table: "approvers", op: "insert" });
      expect(insert.payload).toEqual({ client_id: CLIENT, name: "Marina Prado", email: "marina@x.com", job_title: "Marketing", active: true });
    }
    expect(revalidatePath).toHaveBeenCalledWith("/admin/clientes/[id]", "page");
  });

  it("valida no servidor antes de qualquer consulta", async () => {
    const result = await saveApproverAction({}, form({ clientId: CLIENT, name: "A", email: "nao-e-email" }));
    expect(result.fieldErrors).toMatchObject({ name: expect.any(String), email: "Informe um e-mail válido." });
    expect(calls).toHaveLength(0);
  });

  it("cliente inválido, inexistente (RLS esconde) ou arquivado", async () => {
    expect((await saveApproverAction({}, form({ clientId: "x", name: "Marina", email: "m@x.com" }))).error).toMatch(/inválido/);
    respond = () => ({ data: null, error: null });
    expect((await saveApproverAction({}, form({ clientId: CLIENT, name: "Marina", email: "m@x.com" }))).error).toMatch(/não encontrado/);
    respond = () => ({ data: { id: CLIENT, active: false }, error: null });
    expect((await saveApproverAction({}, form({ clientId: CLIENT, name: "Marina", email: "m@x.com" }))).error).toMatch(/arquivado/);
    expect(writes()).toHaveLength(0);
  });

  it("e-mail repetido no cliente (23505) vira erro no campo e-mail", async () => {
    respond = (call) => (call.op === "insert" ? { data: null, error: { code: "23505", message: "duplicate key" } } : { data: { id: CLIENT, active: true }, error: null });
    const result = await saveApproverAction({}, form({ clientId: CLIENT, name: "Marina", email: "m@x.com" }));
    expect(result.fieldErrors?.email).toMatch(/já está cadastrado/);
  });

  it("o banco recusando cliente arquivado (gatilho) chega como mensagem clara", async () => {
    respond = (call) =>
      call.op === "insert" ? { data: null, error: { code: "23514", message: "cliente arquivado: reative o cliente antes de cadastrar em approvers" } } : { data: { id: CLIENT, active: true }, error: null };
    expect((await saveApproverAction({}, form({ clientId: CLIENT, name: "Marina", email: "m@x.com" }))).error).toMatch(/arquivado/);
  });

  it("edita só nome e cargo (nunca e-mail nem login), filtrando pelo id", async () => {
    const result = await saveApproverAction({}, form({ id: APPROVER, name: "Marina P.", email: "outro@x.com", jobTitle: "Diretora", profile_id: "hack", client_id: OTHER }));
    expect(result).toEqual({ ok: true });
    const update = writes()[0];
    expect(update).toMatchObject({ table: "approvers", op: "update" });
    expect(update.payload).toEqual({ name: "Marina P.", job_title: "Diretora" });
    expect(update.filters).toContainEqual(["eq", "id", APPROVER]);
    expect(calls.some((c) => c.table === "clients")).toBe(false);
  });

  it("id malformado ou inexistente na edição", async () => {
    expect((await saveApproverAction({}, form({ id: "1 or 1=1", name: "Marina", email: "" }))).error).toMatch(/inválido/);
    respond = () => ({ data: [], error: null });
    expect((await saveApproverAction({}, form({ id: APPROVER, name: "Marina" }))).error).toMatch(/não encontrado/);
  });
});

describe("setApproverActiveAction", () => {
  it("só muda `active`, do aprovador indicado", async () => {
    expect(await setApproverActiveAction(APPROVER, false)).toEqual({ ok: true });
    expect(writes()[0].payload).toEqual({ active: false });
    expect(writes()[0].filters).toContainEqual(["eq", "id", APPROVER]);
    expect(await setApproverActiveAction(APPROVER, true)).toEqual({ ok: true });
    expect(writes()[1].payload).toEqual({ active: true });
  });

  it("valida os argumentos e responde 'não encontrado' quando a RLS não devolve a linha", async () => {
    expect((await setApproverActiveAction("nao-uuid", false)).error).toMatch(/inválido/);
    expect((await setApproverActiveAction(APPROVER, "false" as unknown as boolean)).error).toMatch(/inválido/);
    respond = () => ({ data: [], error: null });
    expect((await setApproverActiveAction(APPROVER, false)).error).toMatch(/não encontrado/);
  });

  it("nunca apaga: só UPDATE", async () => {
    await setApproverActiveAction(APPROVER, false);
    expect(calls.every((c) => c.op === "update")).toBe(true);
  });
});

describe("linkApproverAction", () => {
  it("chama a função do banco com origem e destino, sem copiar dados no app", async () => {
    expect(await linkApproverAction(APPROVER, CLIENT)).toEqual({ ok: true });
    expect(calls).toEqual([
      { kind: "rpc", table: "link_approver_to_client", op: "rpc", payload: { p_source_approver_id: APPROVER, p_client_id: CLIENT }, filters: [] },
    ]);
  });

  it("valida os ids e traduz os erros do banco", async () => {
    expect((await linkApproverAction("x", CLIENT)).error).toMatch(/inválidos/);
    respond = () => ({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } });
    expect((await linkApproverAction(APPROVER, CLIENT)).error).toMatch(/já está vinculada/);
    respond = () => ({ data: null, error: { code: "P0001", message: "sem permissão" } });
    expect((await linkApproverAction(APPROVER, CLIENT)).error).toMatch(/permissão/);
    respond = () => ({ data: null, error: { code: "23514", message: "cliente arquivado: reative o cliente antes de cadastrar em approvers" } });
    expect((await linkApproverAction(APPROVER, CLIENT)).error).toMatch(/arquivado/);
  });
});

describe("convites (sem envio de e-mail e sem token)", () => {
  it("preparar e cancelar chamam só as funções do banco", async () => {
    expect(await prepareInviteAction(APPROVER)).toEqual({ ok: true });
    expect(await cancelInviteAction(INVITE)).toEqual({ ok: true });
    expect(calls.map((c) => [c.kind, c.table, c.payload])).toEqual([
      ["rpc", "prepare_approver_invite", { p_approver_id: APPROVER }],
      ["rpc", "revoke_approver_invite", { p_invite_id: INVITE }],
    ]);
  });

  it("nenhuma chamada de Auth, de e-mail ou de rede: só o cliente Supabase do usuário (mock sem `auth`)", async () => {
    // O Supabase falso não tem `auth.admin` nem `functions`: qualquer tentativa de convidar/enviar lançaria erro.
    await expect(prepareInviteAction(APPROVER)).resolves.toEqual({ ok: true });
  });

  it("traduz recusas do banco", async () => {
    respond = () => ({ data: null, error: { code: "P0001", message: "o aprovador já tem acesso ao portal" } });
    expect((await prepareInviteAction(APPROVER)).error).toMatch(/já tem acesso/);
    respond = () => ({ data: null, error: { code: "23505", message: "duplicate key" } });
    expect((await prepareInviteAction(APPROVER)).error).toMatch(/convite em aberto/);
    respond = () => ({ data: null, error: { code: "P0001", message: "o convite não está em aberto" } });
    expect((await cancelInviteAction(INVITE)).error).toMatch(/não está mais em aberto/);
    expect((await prepareInviteAction("x")).error).toMatch(/inválido/);
    expect((await cancelInviteAction("x")).error).toMatch(/inválido/);
  });
});

describe("sendInviteAction (envio do convite pelo app)", () => {
  it("só admin e atendimento; designer, aprovador e anônimo não chegam ao serviço", async () => {
    for (const papel of ["designer", "cliente"]) {
      getSessionState.mockResolvedValue(session(papel));
      expect((await sendInviteAction(APPROVER)).error, papel).toMatch(/permissão/);
    }
    getSessionState.mockResolvedValue({ kind: "anonymous" });
    expect((await sendInviteAction(APPROVER)).error).toMatch(/expirou/);
    expect(sendApproverInvite).not.toHaveBeenCalled();
  });

  it("valida o id, confere sob a RLS que o aprovador é visível e só então chama o serviço", async () => {
    getSessionState.mockResolvedValue(session("admin"));
    expect((await sendInviteAction("x")).error).toMatch(/inválido/);
    respond = () => ({ data: null, error: null });
    expect((await sendInviteAction(APPROVER)).error).toMatch(/não encontrado/);
    expect(sendApproverInvite).not.toHaveBeenCalled();

    respond = () => ({ data: { id: APPROVER }, error: null });
    sendApproverInvite.mockResolvedValue({ ok: true, mode: "sent" });
    expect(await sendInviteAction(APPROVER)).toEqual({ ok: true });
    expect(sendApproverInvite).toHaveBeenCalledWith(APPROVER);
    expect(revalidatePath).toHaveBeenCalled();
  });

  it("devolve a mensagem do serviço e esconde falhas inesperadas (sem vazar detalhes)", async () => {
    getSessionState.mockResolvedValue(session("atendimento"));
    respond = () => ({ data: { id: APPROVER }, error: null });
    sendApproverInvite.mockResolvedValueOnce({ ok: false, error: "O envio de e-mail não está configurado neste ambiente." });
    expect((await sendInviteAction(APPROVER)).error).toMatch(/e-mail não está configurado/);
    sendApproverInvite.mockRejectedValueOnce(new Error("SUPABASE_SECRET_KEY inválida"));
    const result = await sendInviteAction(APPROVER);
    expect(result.error).toMatch(/Tente novamente/);
    expect(result.error).not.toMatch(/SECRET/);
  });
});
