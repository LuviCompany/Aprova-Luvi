// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Server Actions do link rápido com o serviço e o cookie FALSOS: mapeamento de respostas e o que é gravado no cookie. */

const issueCode = vi.fn();
const verifyCode = vi.fn();
const decideViaLink = vi.fn();
vi.mock("@/lib/link-approval/service", () => ({
  issueCode: (...a: unknown[]) => issueCode(...a),
  verifyCode: (...a: unknown[]) => verifyCode(...a),
  decideViaLink: (...a: unknown[]) => decideViaLink(...a),
}));
const writeSessionId = vi.fn();
const readSessionId = vi.fn();
vi.mock("@/lib/link-approval/cookie", () => ({
  readSessionId: (...a: unknown[]) => readSessionId(...a),
  writeSessionId: (...a: unknown[]) => writeSessionId(...a),
  requestFingerprint: async () => ({ ip: "1.2.3.4", userAgent: "ua-teste" }),
}));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

import { linkDecideAction, requestCodeAction, verifyCodeAction } from "@/app/aprovar/[token]/actions";

const SAVED = { ...process.env };
const TOKEN = "t".repeat(43);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_URL = "https://projeto-de-teste.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_" + "x".repeat(30);
  delete process.env.APROVA_DEMO_MODE;
  readSessionId.mockResolvedValue("sessao");
});
afterEach(() => {
  process.env = { ...SAVED };
});

describe("requestCodeAction", () => {
  it("traduz cada resposta do serviço numa mensagem, sem vazar detalhes", async () => {
    const cases: Array<[string, boolean, RegExp?]> = [
      ["sent", true],
      ["cooldown", false, /um minuto/],
      ["limit", false, /Muitos códigos/],
      ["email_unavailable", false, /não está configurado/],
      ["email_failed", false, /Não foi possível enviar/],
      ["revoked", false, /cancelado/],
      ["expired", false, /prazo/],
      ["closed", false, /não está mais aguardando/],
    ];
    for (const [status, ok, text] of cases) {
      issueCode.mockResolvedValueOnce({ status });
      const result = await requestCodeAction(TOKEN);
      expect(Boolean(result.ok), status).toBe(ok);
      if (text) expect(result.error, status).toMatch(text);
    }
    expect(issueCode).toHaveBeenCalledWith(TOKEN, "1.2.3.4");
  });

  it("falha inesperada do serviço vira erro genérico (nada de stack, token ou segredo)", async () => {
    issueCode.mockRejectedValueOnce(new Error("APPROVAL_LINK_SECRET ausente"));
    const result = await requestCodeAction(TOKEN);
    expect(result.error).toMatch(/Tente novamente/);
    expect(result.error).not.toMatch(/APPROVAL|SECRET/);
  });

  it("na demonstração ou sem Supabase não existe", async () => {
    delete process.env.SUPABASE_URL;
    expect((await requestCodeAction(TOKEN)).error).toMatch(/não está disponível/);
    expect(issueCode).not.toHaveBeenCalled();
  });
});

describe("verifyCodeAction", () => {
  it("só abre a sessão (cookie) quando o código está certo", async () => {
    verifyCode.mockResolvedValueOnce({ status: "ok", sessionId: "id-da-sessao" });
    expect(await verifyCodeAction(TOKEN, " 123456 ")).toEqual({ ok: true });
    expect(verifyCode).toHaveBeenCalledWith(TOKEN, "123456", "1.2.3.4");
    expect(writeSessionId).toHaveBeenCalledWith(TOKEN, "id-da-sessao");

    writeSessionId.mockClear();
    for (const status of ["locked", "no_code", "bad_format", "limit", "revoked", "invalid"]) {
      verifyCode.mockResolvedValueOnce({ status });
      expect((await verifyCodeAction(TOKEN, "000000")).error, status).toBeTruthy();
    }
    verifyCode.mockResolvedValueOnce({ status: "invalid_code", remaining: 1 });
    expect((await verifyCodeAction(TOKEN, "000000")).error).toMatch(/Restam 1 tentativa\./);
    verifyCode.mockResolvedValueOnce({ status: "invalid_code", remaining: 3 });
    expect((await verifyCodeAction(TOKEN, "000000")).error).toMatch(/Restam 3 tentativas/);
    expect(writeSessionId).not.toHaveBeenCalled();
  });
});

describe("linkDecideAction", () => {
  it("aprovar: usa a sessão do cookie, o IP e o user-agent do servidor, e atualiza as telas", async () => {
    decideViaLink.mockResolvedValueOnce({ ok: true });
    expect(await linkDecideAction(TOKEN, "aprovado", "")).toEqual({ ok: true });
    expect(decideViaLink).toHaveBeenCalledWith(TOKEN, "sessao", "aprovado", "", "1.2.3.4", "ua-teste");
    expect(revalidatePath).toHaveBeenCalled();
  });

  it("pedir alteração exige 10+ caracteres antes de qualquer chamada", async () => {
    expect((await linkDecideAction(TOKEN, "alteracao", "curto")).error).toMatch(/mínimo de 10/);
    expect((await linkDecideAction(TOKEN, "talvez" as never, "")).error).toBeTruthy();
    expect(decideViaLink).not.toHaveBeenCalled();
  });

  it("recusa do banco volta como mensagem do serviço; falha inesperada vira erro genérico", async () => {
    decideViaLink.mockResolvedValueOnce({ ok: false, error: "Esta solicitação já foi respondida ou encerrada." });
    expect((await linkDecideAction(TOKEN, "aprovado", "")).error).toMatch(/já foi respondida/);
    decideViaLink.mockRejectedValueOnce(new Error("boom"));
    expect((await linkDecideAction(TOKEN, "aprovado", "")).error).toMatch(/Tente novamente/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
