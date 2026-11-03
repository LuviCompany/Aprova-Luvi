// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server Actions de aprovação do painel, com Supabase e e-mail FALSOS. Prova o que o servidor decide: quem pode,
 * o que é validado antes de chegar ao banco, o que vai para as funções (hash do token, nunca o token), e que o
 * painel nunca usa a chave secreta. As regras de verdade (todos aprovam, concorrência) estão em src/test/db.
 */

const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
let rpcError: { code?: string; message?: string } | null = null;
let approver: { id: string; approvers: { name: string; email: string } } | null;

function fakeSupabase() {
  return {
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: null, error: rpcError });
    },
    from: () => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve({ data: approver, error: null }),
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
const sendEmail = vi.fn();
vi.mock("@/lib/email/provider", () => ({ sendEmail: (...args: unknown[]) => sendEmail(...args) }));

import {
  cancelSubmissionAction,
  createApprovalLinkAction,
  revokeApprovalLinkAction,
  submitForApprovalAction,
} from "@/app/admin/materiais/approval-actions";

const VERSION = "4d5e6f70-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const A1 = "11111111-1111-4111-8111-111111111111";
const A2 = "22222222-2222-4222-8222-222222222222";
const REQ = "33333333-3333-4333-8333-333333333333";
const SAVED = { ...process.env };
const sessionOf = (role: string) => ({ kind: "ok", user: { id: "u1", role, organizationId: "o1" } });

beforeEach(() => {
  rpcCalls.length = 0;
  rpcError = null;
  approver = { id: REQ, approvers: { name: "Ana", email: "ana@cliente.test" } };
  vi.clearAllMocks();
  process.env.SUPABASE_URL = "https://projeto-de-teste.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_" + "x".repeat(30);
  process.env.APP_URL = "http://localhost:3000";
  delete process.env.APROVA_DEMO_MODE;
  getSessionState.mockResolvedValue(sessionOf("designer"));
  sendEmail.mockResolvedValue({ ok: true, provider: "simulated" });
});
afterEach(() => {
  process.env = { ...SAVED };
});

describe("submitForApprovalAction", () => {
  it("equipe envia: chama submit_for_approval com os aprovadores, prazo no fim do dia e recado limpo", async () => {
    const result = await submitForApprovalAction({ versionId: VERSION, approverIds: [A1, A2], dueDate: "2026-12-01", message: "  Olá  " });
    expect(result).toEqual({ ok: true });
    expect(rpcCalls).toEqual([
      {
        fn: "submit_for_approval",
        args: { p_version_id: VERSION, p_approver_ids: [A1, A2], p_due_at: "2026-12-01T23:59:59-03:00", p_message: "Olá" },
      },
    ]);
    expect(revalidatePath).toHaveBeenCalled();
  });

  it("sem prazo envia null; cliente (aprovador) e anônimo não enviam", async () => {
    await submitForApprovalAction({ versionId: VERSION, approverIds: [A1], dueDate: null, message: "" });
    expect(rpcCalls[0].args.p_due_at).toBeNull();

    rpcCalls.length = 0;
    getSessionState.mockResolvedValue(sessionOf("cliente"));
    expect((await submitForApprovalAction({ versionId: VERSION, approverIds: [A1], dueDate: null, message: "" })).error).toMatch(/permissão/);
    getSessionState.mockResolvedValue({ kind: "anonymous" });
    expect((await submitForApprovalAction({ versionId: VERSION, approverIds: [A1], dueDate: null, message: "" })).error).toMatch(/expirou/);
    expect(rpcCalls).toHaveLength(0);
  });

  it("entrada inválida nunca chega ao banco", async () => {
    for (const input of [
      { versionId: VERSION, approverIds: [], dueDate: null, message: "" },
      { versionId: VERSION, approverIds: [A1, A1], dueDate: null, message: "" },
      { versionId: "nao-uuid", approverIds: [A1], dueDate: null, message: "" },
      { versionId: VERSION, approverIds: [A1], dueDate: "amanhã", message: "" },
      null,
      "texto",
    ]) {
      expect((await submitForApprovalAction(input)).error, JSON.stringify(input)).toBeTruthy();
    }
    expect(rpcCalls).toHaveLength(0);
  });

  it("erro do banco vira mensagem amigável, sem vazar o texto interno", async () => {
    rpcError = { code: "P0001", message: "o conteúdo mudou desde o último envio desta versão; crie uma nova versão" };
    const result = await submitForApprovalAction({ versionId: VERSION, approverIds: [A1], dueDate: null, message: "" });
    expect(result.error).toMatch(/nova versão/);
    expect(result.error).not.toMatch(/P0001|constraint|desde o último envio desta versão;/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("na demonstração a ação não existe", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    process.env.APROVA_DEMO_MODE = "true";
    expect((await submitForApprovalAction({ versionId: VERSION, approverIds: [A1], dueDate: null, message: "" })).error).toMatch(/demonstração/);
  });
});

describe("cancelamento e revogação", () => {
  it("cancelar e revogar chamam só a função certa, validando o id", async () => {
    expect(await cancelSubmissionAction(REQ)).toEqual({ ok: true });
    expect(await revokeApprovalLinkAction(REQ)).toEqual({ ok: true });
    expect(rpcCalls.map((c) => c.fn)).toEqual(["cancel_approval_request", "revoke_approval_link"]);
    expect((await cancelSubmissionAction("x")).error).toBeTruthy();
    expect((await revokeApprovalLinkAction("x")).error).toBeTruthy();
    expect(rpcCalls).toHaveLength(2);
  });
});

describe("createApprovalLinkAction", () => {
  it("guarda só o HASH do token, devolve o endereço uma vez e envia o e-mail ao aprovador DA solicitação", async () => {
    const result = await createApprovalLinkAction(REQ, A1);
    expect(result.ok).toBe(true);
    const url = result.link?.url ?? "";
    const token = url.split("/aprovar/")[1];
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.link?.emailSent).toBe(true);

    const { fn, args } = rpcCalls[0];
    expect(fn).toBe("create_approval_link");
    expect(args.p_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(args)).not.toContain(token);
    const days = (Date.parse(String(args.p_expires_at)) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7.01);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ to: "ana@cliente.test" });
    expect(String(sendEmail.mock.calls[0][0].text)).toContain(url);
  });

  it("falha de e-mail não derruba o link: avisa para copiar e enviar manualmente", async () => {
    sendEmail.mockResolvedValue({ ok: false, reason: "not_configured" });
    const result = await createApprovalLinkAction(REQ, A1);
    expect(result.ok).toBe(true);
    expect(result.link).toMatchObject({ emailSent: false });
    expect(result.link?.url).toContain("/aprovar/");
  });

  it("nunca registra o token em log", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "info")];
    const result = await createApprovalLinkAction(REQ, A1);
    const token = (result.link?.url ?? "").split("/aprovar/")[1];
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(token);
    vi.restoreAllMocks();
  });

  it("recusa ids inválidos, solicitação inexistente, erro do banco e papel sem permissão", async () => {
    expect((await createApprovalLinkAction("x", A1)).error).toBeTruthy();
    expect((await createApprovalLinkAction(REQ, "x")).error).toBeTruthy();
    approver = null;
    expect((await createApprovalLinkAction(REQ, A1)).error).toMatch(/não encontrada/);
    approver = { id: REQ, approvers: { name: "Ana", email: "ana@cliente.test" } };
    rpcError = { message: "aprovador inválido para esta solicitação" };
    expect((await createApprovalLinkAction(REQ, A2)).error).toMatch(/aprovadores|inativo/);
    expect(sendEmail).not.toHaveBeenCalled();
    getSessionState.mockResolvedValue(sessionOf("cliente"));
    rpcError = null;
    expect((await createApprovalLinkAction(REQ, A1)).error).toMatch(/permissão/);
  });
});
