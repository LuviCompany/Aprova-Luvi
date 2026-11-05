// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Convite pelo app com banco/Auth e e-mail FALSOS: o que o servidor revalida, a ordem (e-mail por último, com desfazer),
 * o reenvio com limite, o aceite e a garantia de que o link só vai no e-mail (nunca em retorno ou log).
 */

type Row = Record<string, unknown>;
const state = {
  approver: null as Row | null,
  client: null as Row | null,
  invites: [] as Row[],
  profileByEmail: null as Row | null,
  linkedApprovers: [] as Row[],
  authUser: { last_sign_in_at: null as string | null },
};
const ops: Array<{ table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> }> = [];
const authCalls: Array<{ fn: string; args: unknown }> = [];
let failOp: string | null = null; // "profiles.insert" | "approvers.update" | "approver_invites.update"
let generateError = false;

function builder(table: string) {
  const call = { table, op: "select", payload: undefined as unknown, filters: [] as Array<[string, unknown]> };
  const run = () => {
    ops.push(call);
    if (failOp === `${table}.${call.op}`) return { data: null, error: { message: "falha simulada" } };
    if (call.op === "select") {
      if (table === "approvers") {
        const byProfile = call.filters.some(([c]) => c === "profile_id");
        return { data: byProfile ? state.linkedApprovers : state.approver, error: null };
      }
      if (table === "clients") return { data: state.client, error: null };
      if (table === "approver_invites") return { data: state.invites, error: null };
      if (table === "profiles") return { data: state.profileByEmail, error: null };
    }
    return { data: null, error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b,
    insert: (p: unknown) => {
      call.op = "insert";
      call.payload = p;
      return b;
    },
    update: (p: unknown) => {
      call.op = "update";
      call.payload = p;
      return b;
    },
    delete: () => {
      call.op = "delete";
      return b;
    },
    eq: (c: string, v: unknown) => {
      call.filters.push([c, v]);
      return b;
    },
    in: (c: string, v: unknown) => {
      call.filters.push([c, v]);
      return b;
    },
    maybeSingle: () => Promise.resolve(run()),
    then: (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
  };
  return b;
}

const USER = "12b162d2-1d66-4ae9-a98b-170edd476397";
const fakeAdmin = {
  from: (table: string) => builder(table),
  auth: {
    admin: {
      generateLink: async (args: { type: string }) => {
        authCalls.push({ fn: "generateLink", args });
        return generateError
          ? { data: null, error: { message: "x" } }
          : { data: { user: { id: USER }, properties: { hashed_token: "hash-do-token-de-teste" } }, error: null };
      },
      deleteUser: async (id: string) => {
        authCalls.push({ fn: "deleteUser", args: id });
        return { error: null };
      },
      getUserById: async () => ({ data: { user: state.authUser }, error: null }),
    },
  },
};
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => fakeAdmin }));
const sendEmail = vi.fn();
vi.mock("@/lib/email/provider", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));

import { markInviteAccepted, sendApproverInvite } from "@/lib/invites/service";

const SAVED = { ...process.env };
const APPROVER = "9b2c6f6a-3f1e-4c53-8d57-6a5c0c0f7a11";
const NOW = Date.parse("2026-11-10T12:00:00Z");
const writes = () => ops.filter((o) => o.op !== "select").map((o) => `${o.table}.${o.op}`);
const freshState = () => {
  state.approver = { id: APPROVER, client_id: "c1", name: "Ana Souza", email: "ana@cliente.test", active: true, profile_id: null };
  state.client = { id: "c1", name: "Casa Aurora", active: true, organization_id: "o1" };
  state.invites = [{ id: "i1", status: "preparado", sent_at: null }];
  state.profileByEmail = null;
  state.linkedApprovers = [];
  state.authUser = { last_sign_in_at: null };
};

beforeEach(() => {
  ops.length = 0;
  authCalls.length = 0;
  failOp = null;
  generateError = false;
  vi.clearAllMocks();
  process.env.EMAIL_PROVIDER = "simulated";
  process.env.APP_URL = "http://localhost:3000";
  freshState();
  sendEmail.mockResolvedValue({ ok: true, provider: "simulated" });
});
afterEach(() => {
  process.env = { ...SAVED };
  vi.unstubAllEnvs();
});

describe("sendApproverInvite — envio", () => {
  it("cria o acesso (Auth, perfil cliente, vínculo), marca o convite e manda o e-mail com o link UMA vez", async () => {
    expect(await sendApproverInvite(APPROVER, NOW)).toEqual({ ok: true, mode: "sent" });
    expect(authCalls.map((c) => c.fn)).toEqual(["generateLink"]);
    expect((authCalls[0].args as { type: string }).type).toBe("invite");
    expect(writes()).toEqual(["profiles.insert", "approvers.update", "approver_invites.update"]);
    const profile = ops.find((o) => o.table === "profiles" && o.op === "insert")!.payload as Row;
    expect(profile).toMatchObject({ id: USER, organization_id: "o1", full_name: "Ana Souza", email: "ana@cliente.test", role: "cliente" });
    expect(Object.keys(profile)).not.toContain("password");
    expect(ops.find((o) => o.table === "approvers" && o.op === "update")!.payload).toEqual({ profile_id: USER });
    expect(ops.find((o) => o.table === "approver_invites" && o.op === "update")!.payload).toMatchObject({ status: "enviado" });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = sendEmail.mock.calls[0][0] as { to: string; text: string; html: string; idempotencyKey: string };
    expect(mail.to).toBe("ana@cliente.test");
    expect(mail.text).toContain("http://localhost:3000/auth/invite?token_hash=hash-do-token-de-teste&type=invite");
    expect(mail.html).toContain("Criar minha senha");
    expect(mail.idempotencyKey).toBe("invite-i1");
  });

  it("o resultado e o log nunca carregam o link nem o token", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    const result = await sendApproverInvite(APPROVER, NOW);
    expect(JSON.stringify(result)).not.toMatch(/token|auth\/invite|hash-do/);
    expect(JSON.stringify(spies.map((s) => s.mock.calls))).not.toContain("hash-do-token-de-teste");
    vi.restoreAllMocks();
  });

  it("sem provedor de e-mail ou sem APP_URL, falha ANTES de tocar no Auth ou no banco", async () => {
    delete process.env.EMAIL_PROVIDER;
    expect((await sendApproverInvite(APPROVER, NOW)).ok).toBe(false);
    process.env.EMAIL_PROVIDER = "simulated";
    vi.stubEnv("NODE_ENV", "production");
    process.env.E2E_SIMULATED_EMAIL = "true";
    process.env.APP_URL = "";
    expect((await sendApproverInvite(APPROVER, NOW)).ok).toBe(false);
    expect(ops).toHaveLength(0);
    expect(authCalls).toHaveLength(0);
  });

  it("recusa aprovador inativo, cliente arquivado, sem convite preparado, com login ou com perfil do mesmo e-mail", async () => {
    const casos: Array<[() => void, RegExp]> = [
      [() => (state.approver = { ...state.approver!, active: false }), /inativo/],
      [() => (state.client = { ...state.client!, active: false }), /arquivado/],
      [() => (state.invites = []), /Prepare o convite/],
      [() => (state.approver = { ...state.approver!, profile_id: USER }), /já tem acesso/],
      [() => (state.profileByEmail = { id: "p" }), /Já existe um login/],
      [() => (state.approver = null), /não encontrado/],
    ];
    for (const [mutate, expected] of casos) {
      ops.length = 0;
      authCalls.length = 0;
      freshState();
      mutate();
      const result = await sendApproverInvite(APPROVER, NOW);
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toMatch(expected);
      expect(authCalls).toHaveLength(0);
      expect(writes()).toEqual([]);
    }
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("sendApproverInvite — desfazer", () => {
  it("se o e-mail falha, remove o usuário e o perfil, solta o vínculo e devolve o convite a 'preparado'", async () => {
    sendEmail.mockResolvedValue({ ok: false, reason: "rejected" });
    const result = await sendApproverInvite(APPROVER, NOW);
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/recusou a mensagem/);
    expect(authCalls.map((c) => c.fn)).toEqual(["generateLink", "deleteUser"]);
    expect(writes()).toEqual([
      "profiles.insert",
      "approvers.update",
      "approver_invites.update", // criou
      "approver_invites.update",
      "approvers.update",
      "profiles.delete", // desfez
    ]);
    expect(ops.filter((o) => o.table === "approver_invites" && o.op === "update")[1].payload).toMatchObject({ status: "preparado", sent_at: null });
    expect(ops.filter((o) => o.table === "approvers" && o.op === "update")[1].payload).toEqual({ profile_id: null });
  });

  it("mensagens por motivo de falha do e-mail", async () => {
    for (const [reason, text] of [
      ["rate_limited", /aguardar/],
      ["failed", /Tente novamente/],
      ["not_configured", /não está configurado/],
    ] as const) {
      sendEmail.mockResolvedValue({ ok: false, reason });
      expect(((await sendApproverInvite(APPROVER, NOW)) as { error: string }).error).toMatch(text);
    }
  });

  it("falha ao criar perfil, vincular ou marcar o convite também desfaz tudo e não envia e-mail", async () => {
    for (const op of ["profiles.insert", "approvers.update", "approver_invites.update"]) {
      authCalls.length = 0;
      failOp = op;
      const result = await sendApproverInvite(APPROVER, NOW);
      expect(result.ok, op).toBe(false);
      expect(authCalls.map((c) => c.fn), op).toContain("deleteUser");
    }
    expect(sendEmail).not.toHaveBeenCalled();
    failOp = null;
    generateError = true;
    ops.length = 0;
    expect((await sendApproverInvite(APPROVER, NOW)).ok).toBe(false);
    expect(writes()).toEqual([]);
  });
});

describe("sendApproverInvite — reenvio", () => {
  beforeEach(() => {
    state.approver = { ...state.approver!, profile_id: USER };
    state.invites = [{ id: "i1", status: "enviado", sent_at: new Date(NOW - 5 * 60_000).toISOString() }];
  });

  it("gera um link de recuperação, atualiza o horário e manda o e-mail de novo", async () => {
    expect(await sendApproverInvite(APPROVER, NOW)).toEqual({ ok: true, mode: "resent" });
    expect((authCalls[0].args as { type: string }).type).toBe("recovery");
    expect(writes()).toEqual(["approver_invites.update"]); // sem criar perfil nem vínculo de novo
    const mail = sendEmail.mock.calls[0][0] as { text: string; subject: string };
    expect(mail.text).toContain("/auth/recovery?token_hash=");
    expect(mail.subject).toMatch(/Novo link/);
  });

  it("no máximo um reenvio por minuto; quem já ativou o acesso não recebe novo convite", async () => {
    state.invites = [{ id: "i1", status: "enviado", sent_at: new Date(NOW - 10_000).toISOString() }];
    expect(((await sendApproverInvite(APPROVER, NOW)) as { error: string }).error).toMatch(/Aguarde um minuto/);
    expect(authCalls).toHaveLength(0);
    state.invites = [{ id: "i1", status: "enviado", sent_at: new Date(NOW - 5 * 60_000).toISOString() }];
    state.authUser = { last_sign_in_at: "2026-11-09T10:00:00Z" };
    expect(((await sendApproverInvite(APPROVER, NOW)) as { error: string }).error).toMatch(/já abriu o convite/);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("se o e-mail do reenvio falha, o relógio volta e a equipe pode tentar já", async () => {
    sendEmail.mockResolvedValue({ ok: false, reason: "failed" });
    expect((await sendApproverInvite(APPROVER, NOW)).ok).toBe(false);
    const updates = ops.filter((o) => o.table === "approver_invites" && o.op === "update");
    expect(updates).toHaveLength(2);
    expect(updates[1].payload).toEqual({ sent_at: new Date(NOW - 5 * 60_000).toISOString() });
  });
});

describe("markInviteAccepted", () => {
  it("o convite enviado do aprovador ligado a este login vira aceito", async () => {
    state.linkedApprovers = [{ id: APPROVER }];
    await markInviteAccepted(USER);
    const update = ops.find((o) => o.table === "approver_invites" && o.op === "update")!;
    expect(update.payload).toMatchObject({ status: "aceito" });
    expect(update.filters).toEqual(expect.arrayContaining([["approver_id", [APPROVER]], ["status", "enviado"]]));
  });

  it("sem aprovador ligado não faz nada, e uma falha do banco nunca quebra a troca de senha", async () => {
    await markInviteAccepted(USER);
    expect(writes()).toEqual([]);
    state.linkedApprovers = [{ id: APPROVER }];
    failOp = "approver_invites.update";
    await expect(markInviteAccepted(USER)).resolves.toBeUndefined();
  });
});
