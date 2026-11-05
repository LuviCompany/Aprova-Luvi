// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "@/lib/email/provider";
import { approvalLinkEmail, escapeHtml, inviteEmail, verificationCodeEmail } from "@/lib/email/templates";

const RESEND = { EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_chave_de_teste", EMAIL_FROM: "Aprova Luvi <aprovacao@exemplo.test>" } as unknown as NodeJS.ProcessEnv;
const msg = { to: "ana@cliente.test", subject: "Assunto", text: "texto 123456", html: "<p>html</p>", idempotencyKey: "k-1" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("modelos de e-mail", () => {
  it("convite: texto e HTML levam o link, a validade e o nome da empresa; reenvio muda o assunto", () => {
    const url = "https://aprova.exemplo.test/auth/invite?token_hash=abc&type=invite";
    const first = inviteEmail({ name: "Ana", clientName: "Casa Aurora", url, validityHours: 24 });
    expect(first.subject).toBe("Seu acesso ao portal Aprova Luvi");
    expect(first.text).toContain(url);
    expect(first.text).toContain("24 horas");
    expect(first.html).toContain(`href="${escapeHtml(url)}"`);
    expect(first.html).toContain("Criar minha senha");
    expect(inviteEmail({ name: "Ana", clientName: "Casa Aurora", url, validityHours: 24, resend: true }).subject).toMatch(/Novo link/);
  });

  it("todo valor variável é escapado no HTML (nome, empresa e código)", () => {
    const evil = `<img src=x onerror="alert(1)">`;
    const invite = inviteEmail({ name: evil, clientName: evil, url: "https://x.test/?a=1&b=2", validityHours: 24 });
    const code = verificationCodeEmail({ name: evil, code: "123456", validityMinutes: 10 });
    const link = approvalLinkEmail({ name: evil, url: "https://x.test/aprovar/t", validityDays: 7 });
    for (const html of [invite.html, code.html, link.html]) {
      expect(html).not.toContain("<img");
      expect(html).toContain("&lt;img");
    }
    expect(invite.html).toContain("a=1&amp;b=2");
  });

  it("o código de verificação mantém o formato que o app lê (\"é: 123456\") e o assunto fixo", () => {
    const mail = verificationCodeEmail({ name: "Ana", code: "004217", validityMinutes: 10 });
    expect(mail.text).toMatch(/Seu código de verificação é: 004217/);
    expect(mail.subject).toBe("Seu código de verificação · Aprova Luvi");
    expect(mail.html).toContain("004217");
  });
});

describe("Resend: chamada, erros e proteção de credenciais", () => {
  it("manda remetente, destinatário, texto, HTML e chave de idempotência; a chave vai só no cabeçalho de autorização", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendEmail(msg, RESEND)).toEqual({ ok: true, provider: "resend" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.authorization).toBe("Bearer re_chave_de_teste");
    expect(init.headers["idempotency-key"]).toBe("k-1");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ from: "Aprova Luvi <aprovacao@exemplo.test>", to: ["ana@cliente.test"], subject: "Assunto", text: "texto 123456", html: "<p>html</p>" });
    expect(init.body).not.toContain("re_chave_de_teste");
  });

  it("classifica as falhas: 429 pede para aguardar, 4xx é recusa definitiva, 5xx e rede são falha transitória", async () => {
    const respond = (status: number) => vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status }));
    respond(429);
    expect(await sendEmail(msg, RESEND)).toEqual({ ok: false, reason: "rate_limited" });
    for (const status of [400, 401, 403, 422]) {
      respond(status);
      expect(await sendEmail(msg, RESEND), String(status)).toEqual({ ok: false, reason: "rejected" });
    }
    for (const status of [500, 502, 503]) {
      respond(status);
      expect(await sendEmail(msg, RESEND), String(status)).toEqual({ ok: false, reason: "failed" });
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    expect(await sendEmail(msg, RESEND)).toEqual({ ok: false, reason: "failed" });
  });

  it("sem idempotência ou sem HTML, não manda esses campos; e nada do corpo ou da chave vai para log", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "info")];
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);
    await sendEmail({ to: "a@b.test", subject: "s", text: "codigo 998877" }, RESEND);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["idempotency-key"]).toBeUndefined();
    expect(JSON.parse(init.body).html).toBeUndefined();
    const logged = JSON.stringify(spies.map((s) => s.mock.calls));
    expect(logged).not.toContain("998877");
    expect(logged).not.toContain("re_chave_de_teste");
  });

  it("sem chave ou sem remetente o provedor nem tenta (not_configured), e a rede não é chamada", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;
    expect(await sendEmail(msg, env({ EMAIL_PROVIDER: "resend", EMAIL_FROM: "x@y.test" }))).toEqual({ ok: false, reason: "not_configured" });
    expect(await sendEmail(msg, env({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_x" }))).toEqual({ ok: false, reason: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
