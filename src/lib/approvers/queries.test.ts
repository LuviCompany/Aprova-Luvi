// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Step {
  method: string;
  args: unknown[];
}
interface Call {
  table: string;
  steps: Step[];
}
type Result = { data: unknown; error: { message: string; code?: string } | null };

const calls: Call[] = [];
let respond: (call: Call) => Result;

function builderFor(table: string) {
  const call: Call = { table, steps: [] };
  const run = () => {
    calls.push(call);
    return Promise.resolve(respond(call));
  };
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "in", "ilike", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      call.steps.push({ method, args });
      return builder;
    };
  }
  builder.maybeSingle = run;
  builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) => run().then(resolve, reject);
  return builder;
}
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ from: builderFor }) }));

import { getClientDetail } from "./queries";

const C1 = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const C2 = "4d5e6f70-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const A1 = "9b2c6f6a-3f1e-4c53-8d57-6a5c0c0f7a11";
const A2 = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d";
const A3 = "6b7c8d9e-0f1a-4b2c-8d3e-4f5a6b7c8d9e";
const P1 = "8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e1f";
const LOGIN = "0b8f2a6e-5d8c-4a3e-9f57-2f1a3c4d5e6f";

const has = (call: Call, method: string, ...args: unknown[]) =>
  call.steps.some((s) => s.method === method && args.every((a, i) => s.args[i] === a));

const client = { id: C1, name: "Casa Aurora", segment: "Varejo", initials: "CA", active: true };
const base = (over: Partial<{ client: unknown; approvers: unknown; invites: unknown; others: unknown; projects: unknown }> = {}) => {
  const data = {
    client,
    approvers: [
      { id: A1, name: "Marina Prado", email: "marina@x.com", job_title: "Marketing", active: true, profile_id: LOGIN },
      { id: A2, name: "Paulo Aurora", email: "paulo@x.com", job_title: "", active: true, profile_id: null },
    ],
    invites: [{ id: P1, approver_id: A2, status: "preparado" }],
    others: [
      { id: A3, client_id: C2, name: "Marina Prado", email: "marina@x.com", job_title: "", active: true, profile_id: LOGIN, clients: { name: "Vita Nutri" } },
      { id: P1, client_id: C2, name: "Bia Souza", email: "bia@x.com", job_title: "Sócia", active: true, profile_id: null, clients: { name: "Vita Nutri" } },
    ],
    projects: [],
    ...over,
  };
  respond = (call) => {
    if (call.table === "clients") return { data: data.client, error: null };
    if (call.table === "approver_invites") return { data: data.invites, error: null };
    if (call.table === "projects") return { data: data.projects, error: null };
    // approvers: do cliente (eq client_id) ou de outros clientes (neq client_id)
    return { data: has(call, "neq", "client_id") ? data.others : data.approvers, error: null };
  };
};

beforeEach(() => {
  calls.length = 0;
});

describe("getClientDetail", () => {
  it("monta aprovadores com status de acesso, convite aberto e 'também aprova para'", async () => {
    base();
    const detail = await getClientDetail(C1);
    expect(detail?.client).toEqual(client);
    expect(detail?.approvers).toEqual([
      { id: A1, name: "Marina Prado", email: "marina@x.com", jobTitle: "Marketing", active: true, hasLogin: true, access: "login", inviteId: null, alsoApprovesFor: ["Vita Nutri"] },
      { id: A2, name: "Paulo Aurora", email: "paulo@x.com", jobTitle: "", active: true, hasLogin: false, access: "convite_preparado", inviteId: P1, alsoApprovesFor: [] },
    ]);
  });

  it("candidatos a vínculo: só pessoas de OUTROS clientes que ainda não estão neste", async () => {
    base();
    const detail = await getClientDetail(C1);
    expect(detail?.linkCandidates.map((c) => c.email)).toEqual(["bia@x.com"]); // Marina já está aqui
  });

  it("cliente arquivado não oferece candidatos (o banco recusaria o vínculo)", async () => {
    base({ client: { ...client, active: false } });
    expect((await getClientDetail(C1))?.linkCandidates).toEqual([]);
  });

  it("consulta convites só em aberto, só deste cliente, e os outros clientes por neq (sem o cliente atual)", async () => {
    base();
    await getClientDetail(C1);
    const invites = calls.find((c) => c.table === "approver_invites")!;
    expect(has(invites, "eq", "client_id", C1)).toBe(true);
    expect(invites.steps.find((s) => s.method === "in")?.args).toEqual(["status", ["preparado", "enviado"]]);
    const others = calls.find((c) => c.table === "approvers" && has(c, "neq", "client_id"))!;
    expect(has(others, "neq", "client_id", C1)).toBe(true);
  });

  it("antes da migration dos convites (tabela inexistente, PGRST205) a tela funciona sem convites; outro erro de convites falha fechado", async () => {
    base();
    const normal = respond;
    respond = (call) =>
      call.table === "approver_invites"
        ? { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.approver_invites'" } }
        : normal(call);
    const detail = await getClientDetail(C1);
    expect(detail?.approvers.map((a) => a.access)).toEqual(["login", "so_link"]);
    respond = (call) =>
      call.table === "approver_invites" ? { data: null, error: { code: "42501", message: "permission denied" } } : normal(call);
    await expect(getClientDetail(C1)).rejects.toThrow(/convites/);
  });

  it("cliente inexistente ou de outra organização (a RLS não devolve a linha) vira null", async () => {
    base({ client: null });
    expect(await getClientDetail(C1)).toBeNull();
  });

  it("falha fechado: erro do banco ou resposta inesperada", async () => {
    respond = () => ({ data: null, error: { message: "boom" } });
    await expect(getClientDetail(C1)).rejects.toThrow(/Não foi possível carregar/);
    base({ approvers: [{ id: "nao-uuid" }] });
    await expect(getClientDetail(C1)).rejects.toThrow(/resposta inesperada/);
    base({ invites: [{ id: P1, approver_id: A1, status: "aceito" }] });
    await expect(getClientDetail(C1)).rejects.toThrow(/resposta inesperada/);
  });
});
