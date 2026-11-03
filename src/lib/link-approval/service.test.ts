// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Serviço do link rápido com banco e e-mail FALSOS. Prova o que o servidor manda ao banco (só hashes), o que
 * manda por e-mail, quando recusa antes de consultar e que nada sensível vai para log. As regras de verdade
 * (tentativas, expiração, sessão, concorrência) são do banco e estão em src/test/db/approval*.test.ts.
 */

const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
const queries: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
let rpcData: Record<string, unknown>;
let rpcError: { message: string } | null;
let fileRow: { storage_path: string } | null;
let signed: { data: { signedUrl: string } | null; error: unknown };

const fakeAdmin = {
  rpc(fn: string, args: Record<string, unknown>) {
    rpcCalls.push({ fn, args });
    return Promise.resolve({ data: rpcData[fn] ?? null, error: rpcError });
  },
  from(table: string) {
    const q = { table, filters: [] as Array<[string, unknown]> };
    queries.push(q);
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (c: string, v: unknown) => {
        q.filters.push([c, v]);
        return builder;
      },
      maybeSingle: () => Promise.resolve({ data: fileRow, error: null }),
    };
    return builder;
  },
  storage: { from: () => ({ createSignedUrl: async () => signed }) },
};
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => fakeAdmin }));
const sendEmail = vi.fn();
vi.mock("@/lib/email/provider", () => ({ sendEmail: (...args: unknown[]) => sendEmail(...args) }));

import { hashToken, generateToken } from "@/lib/approval/token";
import { resetRateLimits } from "@/lib/link-approval/rate-limit";
import { decideViaLink, getLinkContext, issueCode, resolveLink, signedFileUrl, verifyCode } from "@/lib/link-approval/service";

const SAVED = { ...process.env };
const SECRET = "s".repeat(40);
const LINK = "11111111-1111-4111-8111-111111111111";
const REQ = "22222222-2222-4222-8222-222222222222";
const MATERIAL = "33333333-3333-4333-8333-333333333333";
const VERSION = "44444444-4444-4444-8444-444444444444";
const CLIENT = "55555555-5555-4555-8555-555555555555";
const APPROVER = "66666666-6666-4666-8666-666666666666";
const FILE = "77777777-7777-4777-8777-777777777777";
const OK_CONTEXT = {
  status: "ok", link_id: LINK, request_id: REQ, material_id: MATERIAL, version_id: VERSION, client_id: CLIENT,
  approver_id: APPROVER, approver_name: "Ana", due_at: null,
};

let token: string;
beforeEach(() => {
  rpcCalls.length = 0;
  queries.length = 0;
  rpcData = {};
  rpcError = null;
  fileRow = { storage_path: "c/m/v/f.png" };
  signed = { data: { signedUrl: "https://storage.test/sign/x" }, error: null };
  vi.clearAllMocks();
  resetRateLimits();
  process.env.APPROVAL_LINK_SECRET = SECRET;
  token = generateToken();
  sendEmail.mockResolvedValue({ ok: true, provider: "simulated" });
});
afterEach(() => {
  process.env = { ...SAVED };
  vi.restoreAllMocks();
});

const HEX = /^[0-9a-f]{64}$/;

describe("resolveLink", () => {
  it("manda ao banco só o hash do token, nunca o token", async () => {
    rpcData.link_resolve = { status: "ok", client_name: "Casa Aurora", email_hint: "a***@x.test" };
    expect(await resolveLink(token)).toEqual({ status: "ok", clientName: "Casa Aurora", emailHint: "a***@x.test" });
    expect(rpcCalls[0].args).toEqual({ p_token_hash: hashToken(token) });
    expect(JSON.stringify(rpcCalls)).not.toContain(token);
  });

  it("token com formato impossível é recusado sem consultar o banco", async () => {
    expect(await resolveLink("../../x")).toEqual({ status: "invalid" });
    expect(await resolveLink("")).toEqual({ status: "invalid" });
    expect(rpcCalls).toHaveLength(0);
  });

  it("repassa os estados do banco e falha alto diante de resposta inesperada", async () => {
    for (const status of ["revoked", "expired", "used", "closed", "invalid"] as const) {
      rpcData.link_resolve = { status };
      expect(await resolveLink(token)).toEqual({ status });
    }
    rpcData.link_resolve = { status: "qualquer-coisa" };
    await expect(resolveLink(token)).rejects.toThrow();
    rpcError = { message: "boom" };
    await expect(resolveLink(token)).rejects.toThrow();
  });
});

describe("issueCode", () => {
  it("envia ao banco o HMAC do código (nunca o código) e o e-mail leva o código ao aprovador", async () => {
    rpcData.link_issue_code = { status: "ok", email: "ana@cliente.test", approver_name: "Ana" };
    expect(await issueCode(token, "1.2.3.4")).toEqual({ status: "sent" });

    const args = rpcCalls[0].args;
    expect(args.p_token_hash).toBe(hashToken(token));
    expect(args.p_code_hash).toMatch(HEX);
    const mail = sendEmail.mock.calls[0][0] as { to: string; text: string };
    expect(mail.to).toBe("ana@cliente.test");
    const code = mail.text.match(/código de verificação é: (\d{6})/)?.[1];
    expect(code).toMatch(/^\d{6}$/);
    expect(JSON.stringify(rpcCalls)).not.toContain(code!);
    expect(JSON.stringify(rpcCalls)).not.toContain(token);
  });

  it("não envia e-mail quando o banco recusa (cooldown, limite, link fechado)", async () => {
    for (const status of ["cooldown", "limit", "revoked", "expired", "used", "closed"] as const) {
      rpcData.link_issue_code = { status };
      expect(await issueCode(token, "1.2.3.4")).toEqual({ status });
    }
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("distingue e-mail sem provedor de e-mail com falha; nunca finge que enviou", async () => {
    rpcData.link_issue_code = { status: "ok", email: "ana@cliente.test", approver_name: "Ana" };
    sendEmail.mockResolvedValueOnce({ ok: false, reason: "not_configured" });
    expect(await issueCode(token, "1.2.3.4")).toEqual({ status: "email_unavailable" });
    sendEmail.mockResolvedValueOnce({ ok: false, reason: "failed" });
    expect(await issueCode(token, "1.2.3.4")).toEqual({ status: "email_failed" });
  });

  it("limita pedidos por IP (10 por hora) antes de qualquer consulta ao banco", async () => {
    rpcData.link_issue_code = { status: "cooldown" };
    for (let i = 0; i < 10; i++) await issueCode(token, "9.9.9.9");
    rpcCalls.length = 0;
    expect(await issueCode(token, "9.9.9.9")).toEqual({ status: "limit" });
    expect(rpcCalls).toHaveLength(0);
    expect((await issueCode(token, "8.8.8.8")).status).toBe("cooldown"); // outro IP segue valendo
  });

  it("sem APPROVAL_LINK_SECRET falha alto em vez de usar um segredo fraco", async () => {
    delete process.env.APPROVAL_LINK_SECRET;
    await expect(issueCode(token, "1.2.3.4")).rejects.toThrow(/APPROVAL_LINK_SECRET/);
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("verifyCode", () => {
  it("formato errado nem chega ao banco; acerto devolve uma sessão cujo HMAC (não o valor) vai ao banco", async () => {
    expect(await verifyCode(token, "12345", "1.1.1.1")).toEqual({ status: "bad_format" });
    expect(await verifyCode(token, "abcdef", "1.1.1.1")).toEqual({ status: "bad_format" });
    expect(rpcCalls).toHaveLength(0);

    rpcData.link_verify_code = { status: "ok" };
    const result = await verifyCode(token, "123456", "1.1.1.1");
    expect(result.status).toBe("ok");
    const sessionId = (result as { sessionId: string }).sessionId;
    expect(sessionId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const args = rpcCalls[0].args;
    expect(args.p_session_hash).toMatch(HEX);
    expect(JSON.stringify(args)).not.toContain(sessionId);
    expect(JSON.stringify(args)).not.toContain("123456");
  });

  it("repassa tentativas restantes, bloqueio e códigos vencidos; sem sessão em nenhum desses casos", async () => {
    rpcData.link_verify_code = { status: "invalid_code", remaining: 3 };
    expect(await verifyCode(token, "000000", "1.1.1.1")).toEqual({ status: "invalid_code", remaining: 3 });
    for (const status of ["locked", "no_code", "revoked", "expired", "used", "closed"] as const) {
      rpcData.link_verify_code = { status };
      expect(await verifyCode(token, "000000", "1.1.1.1")).toEqual({ status });
    }
  });

  it("limita tentativas por IP (30 em 10 minutos)", async () => {
    rpcData.link_verify_code = { status: "invalid_code", remaining: 0 };
    for (let i = 0; i < 30; i++) await verifyCode(token, "000000", "7.7.7.7");
    rpcCalls.length = 0;
    expect(await verifyCode(token, "000000", "7.7.7.7")).toEqual({ status: "limit" });
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("getLinkContext", () => {
  it("sem cookie de sessão: não mostra nada do material, só pede a verificação (ou o problema do link)", async () => {
    rpcData.link_resolve = { status: "ok", client_name: "Casa", email_hint: "a***@x.test" };
    expect(await getLinkContext(token, undefined)).toEqual({ status: "no_session" });
    expect(rpcCalls.map((c) => c.fn)).toEqual(["link_resolve"]);
    rpcData.link_resolve = { status: "revoked" };
    expect(await getLinkContext(token, undefined)).toEqual({ status: "revoked" });
  });

  it("cookie com formato inválido é tratado como sem sessão; sessão válida devolve o escopo do link", async () => {
    rpcData.link_resolve = { status: "ok", client_name: "Casa", email_hint: "a***@x.test" };
    expect(await getLinkContext(token, "lixo")).toEqual({ status: "no_session" });

    rpcData.link_session_context = OK_CONTEXT;
    const sessionId = "a".repeat(43);
    const result = await getLinkContext(token, sessionId);
    expect(result).toEqual({
      status: "ok",
      context: { linkId: LINK, requestId: REQ, materialId: MATERIAL, versionId: VERSION, clientId: CLIENT, approverId: APPROVER, approverName: "Ana", dueAt: null },
    });
    const call = rpcCalls.find((c) => c.fn === "link_session_context")!;
    expect(call.args.p_session_hash).toMatch(HEX);
    expect(JSON.stringify(call.args)).not.toContain(sessionId);
  });
});

describe("decideViaLink", () => {
  const decide = (note = "") => decideViaLink(token, "a".repeat(43), "aprovado", note, "1.2.3.4", "Mozilla/5.0 ".repeat(40));

  it("manda ao banco hash do token, HMAC da sessão, IP em HMAC e user-agent truncado", async () => {
    expect(await decide()).toEqual({ ok: true });
    const { fn, args } = rpcCalls[0];
    expect(fn).toBe("decide_with_link_session");
    expect(args.p_token_hash).toBe(hashToken(token));
    expect(args.p_session_hash).toMatch(HEX);
    expect(args.p_ip_hash).toMatch(HEX);
    expect(JSON.stringify(args)).not.toContain("1.2.3.4");
    expect(String(args.p_user_agent).length).toBeLessThanOrEqual(300);
  });

  it("sem sessão no cookie recusa antes do banco", async () => {
    expect((await decideViaLink(token, undefined, "aprovado", "", "1.2.3.4", "")).ok).toBe(false);
    expect((await decideViaLink(token, "curta", "aprovado", "", "1.2.3.4", "")).ok).toBe(false);
    expect((await decideViaLink("../x", "a".repeat(43), "aprovado", "", "1.2.3.4", "")).ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });

  it("traduz os erros do banco sem vazar texto interno", async () => {
    const cases: Array<[string, RegExp]> = [
      ["sessão de verificação inválida ou expirada", /verificação expirou/],
      ["link indisponível (revoked)", /não está mais disponível/],
      ["esta solicitação já foi encerrada", /já foi respondida/],
      ["erro qualquer do postgres: relation x", /Tente novamente/],
    ];
    for (const [message, expected] of cases) {
      rpcError = { message };
      const result = await decide();
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toMatch(expected);
      expect((result as { error: string }).error).not.toContain(message);
    }
  });
});

describe("signedFileUrl", () => {
  it("só assina arquivo da VERSÃO do link verificado, da mesma empresa", async () => {
    rpcData.link_session_context = OK_CONTEXT;
    const url = await signedFileUrl(token, "a".repeat(43), FILE);
    expect(url).toBe("https://storage.test/sign/x");
    const q = queries.find((x) => x.table === "material_files")!;
    expect(q.filters).toEqual(expect.arrayContaining([["id", FILE], ["version_id", VERSION], ["client_id", CLIENT]]));
  });

  it("sem sessão, id inválido, arquivo fora do escopo ou falha na assinatura: nada (null)", async () => {
    rpcData.link_resolve = { status: "ok", client_name: "C", email_hint: "a***@x" };
    expect(await signedFileUrl(token, undefined, FILE)).toBeNull();
    expect(await signedFileUrl(token, "a".repeat(43), "nao-uuid")).toBeNull();
    rpcData.link_session_context = OK_CONTEXT;
    fileRow = null;
    expect(await signedFileUrl(token, "a".repeat(43), FILE)).toBeNull();
    fileRow = { storage_path: "c/m/v/f.png" };
    signed = { data: null, error: { message: "x" } };
    expect(await signedFileUrl(token, "a".repeat(43), FILE)).toBeNull();
  });
});

describe("higiene de log", () => {
  it("nada do fluxo escreve token, código ou sessão em console", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "info"), vi.spyOn(console, "debug")];
    rpcData.link_issue_code = { status: "ok", email: "ana@cliente.test", approver_name: "Ana" };
    rpcData.link_verify_code = { status: "ok" };
    rpcData.link_resolve = { status: "ok", client_name: "C", email_hint: "a***@x" };
    await resolveLink(token);
    await issueCode(token, "1.1.1.1");
    const verified = await verifyCode(token, "123456", "1.1.1.1");
    await decideViaLink(token, (verified as { sessionId: string }).sessionId, "aprovado", "", "1.1.1.1", "ua");
    const logged = JSON.stringify(spies.map((s) => s.mock.calls));
    expect(logged).not.toContain(token);
    expect(logged).not.toContain("123456");
  });
});
