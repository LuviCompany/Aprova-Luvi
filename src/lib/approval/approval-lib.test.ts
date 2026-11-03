// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail, readSimulatedOutbox, clearSimulatedOutbox } from "@/lib/email/provider";
import { generateToken, hashToken, isPlausibleToken, approvalLinkUrl, TOKEN_PATTERN } from "@/lib/approval/token";
import { commentSchema, decisionInputSchema, decisionSchema, dueDateToTimestamp, submitSchema } from "@/lib/approval/schema";
import { messageForApprovalError } from "@/lib/approval/errors";
import { codeHash, generateCode, generateSessionId, ipHash, sessionHash, CODE_PATTERN, SESSION_ID_PATTERN } from "@/lib/link-approval/crypto";
import { allow, resetRateLimits } from "@/lib/link-approval/rate-limit";
import { linkStateOf, summarize } from "@/lib/approval/staff-queries";
import { bucketOf } from "@/lib/approval/portal-queries";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("token do link", () => {
  it("tem 256 bits aleatórios em base64url, nunca repete e o hash é SHA-256 hex", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken()));
    expect(tokens.size).toBe(200);
    for (const t of tokens) {
      expect(t).toMatch(TOKEN_PATTERN);
      expect(isPlausibleToken(t)).toBe(true);
      expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
      expect(hashToken(t)).not.toContain(t);
    }
    expect(hashToken("a")).toBe(hashToken("a"));
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });

  it("recusa o que não parece um token antes de qualquer consulta", () => {
    for (const bad of ["", "curto", "a".repeat(44), "../../etc/passwd" + "a".repeat(30), "a b".repeat(20), undefined, 42, null]) {
      expect(isPlausibleToken(bad), String(bad)).toBe(false);
    }
  });

  it("monta o endereço a partir do APP_URL do ambiente (nunca de entrada do usuário)", () => {
    const token = generateToken();
    expect(approvalLinkUrl(token, { APP_URL: "http://localhost:3000" } as unknown as NodeJS.ProcessEnv)).toBe(`http://localhost:3000/aprovar/${token}`);
    expect(approvalLinkUrl(token, { NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("validação do envio e da decisão", () => {
  it("o envio exige 1 a 20 aprovadores distintos, prazo válido e recado curto", () => {
    const ok = submitSchema.safeParse({ versionId: A, approverIds: [A, B], dueDate: "2026-12-01", message: "  oi  " });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.message).toBe("oi");
    for (const bad of [
      { versionId: A, approverIds: [], dueDate: null, message: "" },
      { versionId: A, approverIds: [A, A], dueDate: null, message: "" },
      { versionId: A, approverIds: [A], dueDate: "01/12/2026", message: "" },
      { versionId: A, approverIds: [A], dueDate: "2026-13-45", message: "" },
      { versionId: "x", approverIds: [A], dueDate: null, message: "" },
      { versionId: A, approverIds: [A], dueDate: null, message: "m".repeat(501) },
      { versionId: A, approverIds: Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`), dueDate: null, message: "" },
    ]) {
      expect(submitSchema.safeParse(bad).success, JSON.stringify(bad).slice(0, 60)).toBe(false);
    }
    expect(dueDateToTimestamp("2026-12-01")).toBe("2026-12-01T23:59:59-03:00");
  });

  it("pedir alteração exige 10+ caracteres úteis; aprovar não exige nota", () => {
    expect(decisionSchema.safeParse({ requestId: A, decision: "aprovado", note: "" }).success).toBe(true);
    expect(decisionSchema.safeParse({ requestId: A, decision: "alteracao", note: "curto" }).success).toBe(false);
    expect(decisionSchema.safeParse({ requestId: A, decision: "alteracao", note: "          " }).success).toBe(false);
    expect(decisionSchema.safeParse({ requestId: A, decision: "alteracao", note: "Trocar a imagem do slide 2" }).success).toBe(true);
    expect(decisionInputSchema.safeParse({ decision: "alteracao", note: "x".repeat(4001) }).success).toBe(false);
    expect(decisionSchema.safeParse({ requestId: A, decision: "talvez", note: "" }).success).toBe(false);
  });

  it("comentário: slide entre 1 e 10 ou geral, texto obrigatório", () => {
    expect(commentSchema.safeParse({ materialId: A, versionId: B, slide: null, body: "ok" }).success).toBe(true);
    expect(commentSchema.safeParse({ materialId: A, versionId: B, slide: 3, body: "ok" }).success).toBe(true);
    expect(commentSchema.safeParse({ materialId: A, versionId: B, slide: 0, body: "ok" }).success).toBe(false);
    expect(commentSchema.safeParse({ materialId: A, versionId: B, slide: 11, body: "ok" }).success).toBe(false);
    expect(commentSchema.safeParse({ materialId: A, versionId: B, slide: null, body: "   " }).success).toBe(false);
  });
});

describe("mensagens de erro do fluxo de aprovação", () => {
  it("traduz as exceções do banco sem repassar o texto original", () => {
    const cases: Array<[string, RegExp]> = [
      ["escolha de 1 a 20 aprovadores, sem repetir", /1 a 20 aprovadores/],
      ["só material em rascunho pode ser enviado para aprovação", /rascunho/],
      ["o conteúdo mudou desde o último envio desta versão; crie uma nova versão", /nova versão/],
      ["esta solicitação já foi encerrada", /já foi respondida/],
      ["esta solicitação é de uma versão que não está mais em aprovação", /não está mais em aprovação/],
      ["sem permissão", /permissão/],
    ];
    for (const [text, expected] of cases) {
      const message = messageForApprovalError({ message: text });
      expect(message).toMatch(expected);
      expect(message).not.toBe(text);
    }
    expect(messageForApprovalError({ code: "42501", message: "permission denied for table x" })).toMatch(/permissão/);
    expect(messageForApprovalError({ message: "fetch failed" })).not.toMatch(/fetch/);
    expect(messageForApprovalError({ message: "erro estranho do postgres: relation \"decisions\" pg_class" })).not.toMatch(/pg_class/);
  });
});

describe("resumos de tela", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  it("estado do link: revogado vence usado, que vence expirado", () => {
    const base = { expires_at: "2026-11-20T00:00:00Z", revoked_at: null, used_at: null };
    expect(linkStateOf(base, now)).toBe("ativo");
    expect(linkStateOf({ ...base, expires_at: "2026-11-01T00:00:00Z" }, now)).toBe("expirado");
    expect(linkStateOf({ ...base, used_at: "2026-11-05T00:00:00Z", expires_at: "2026-11-01T00:00:00Z" }, now)).toBe("usado");
    expect(linkStateOf({ ...base, revoked_at: "2026-11-05T00:00:00Z", used_at: "2026-11-05T00:00:00Z" }, now)).toBe("revogado");
  });

  it("resumo do envio: qualquer alteração vence; aprovada só quando TODOS aprovaram", () => {
    const aprovou = { status: "decidida" as const, decision: { kind: "aprovado" as const, note: "", via: "portal" as const, at: "x" } };
    const alterou = { status: "decidida" as const, decision: { kind: "alteracao" as const, note: "n".repeat(12), via: "link" as const, at: "x" } };
    const aberta = { status: "aberta" as const, decision: null };
    const cancelada = { status: "cancelada" as const, decision: null };
    expect(summarize([aprovou, aprovou])).toBe("aprovada");
    expect(summarize([aprovou, aberta])).toBe("em_andamento");
    expect(summarize([aprovou, alterou, cancelada])).toBe("alteracao");
    expect(summarize([cancelada, cancelada])).toBe("cancelada");
    expect(summarize([])).toBe("cancelada");
  });

  it("categoria do portal: pendente (minha solicitação aberta) > aprovado > aguardando outros > ajustes", () => {
    expect(bucketOf("aguardando", true)).toBe("pendente");
    expect(bucketOf("aguardando", false)).toBe("aguardando_outros");
    expect(bucketOf("aprovado", false)).toBe("aprovado");
    expect(bucketOf("alteracao", false)).toBe("ajustes");
    expect(bucketOf("rascunho", false)).toBe("ajustes");
  });
});

describe("primitivas do fluxo por link", () => {
  const SECRET = "s".repeat(40);

  it("códigos têm 6 dígitos, vêm de fonte criptográfica e sessões têm 256 bits", () => {
    for (let i = 0; i < 300; i++) expect(generateCode()).toMatch(CODE_PATTERN);
    expect(new Set(Array.from({ length: 200 }, () => generateCode())).size).toBeGreaterThan(150);
    const sessions = new Set(Array.from({ length: 100 }, () => generateSessionId()));
    expect(sessions.size).toBe(100);
    for (const s of sessions) expect(s).toMatch(SESSION_ID_PATTERN);
  });

  it("o hash do código depende do segredo E do link; ninguém hasheia sem o segredo", () => {
    const th = hashToken("tok");
    const h = codeHash(SECRET, th, "123456");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("123456");
    expect(codeHash(SECRET, th, "123456")).toBe(h);
    expect(codeHash(SECRET, th, "123457")).not.toBe(h);
    expect(codeHash(SECRET, hashToken("outro"), "123456")).not.toBe(h); // mesmo código, outro link
    expect(codeHash("x".repeat(40), th, "123456")).not.toBe(h); // outro segredo
  });

  it("sessão e IP também são HMAC com rótulos distintos (um não vira o outro)", () => {
    expect(sessionHash(SECRET, "abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(sessionHash(SECRET, "abc")).not.toBe(ipHash(SECRET, "abc"));
    expect(ipHash(SECRET, "1.2.3.4")).not.toContain("1.2.3.4");
  });
});

describe("limitador de tentativas", () => {
  beforeEach(() => resetRateLimits());

  it("bloqueia depois do máximo dentro da janela e libera quando ela passa", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect(allow("k", 3, 1000, t0 + i)).toBe(true);
    expect(allow("k", 3, 1000, t0 + 10)).toBe(false);
    expect(allow("outra", 3, 1000, t0 + 10)).toBe(true); // chaves independentes
    expect(allow("k", 3, 1000, t0 + 1500)).toBe(true);
  });
});

describe("e-mail (provedor simulado e resend)", () => {
  const SAVED = { ...process.env };
  beforeEach(() => clearSimulatedOutbox());
  afterEach(() => {
    process.env = { ...SAVED };
    vi.restoreAllMocks();
  });
  const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

  it("o simulado guarda só em memória e responde ok; em produção é recusado e nada é guardado", async () => {
    const msg = { to: "a@x.test", subject: "Assunto", text: "código 123456" };
    expect(await sendEmail(msg, env({ EMAIL_PROVIDER: "simulated" }))).toEqual({ ok: true, provider: "simulated" });
    expect(readSimulatedOutbox(env({ EMAIL_PROVIDER: "simulated" }))).toHaveLength(1);
    expect(readSimulatedOutbox(env({ EMAIL_PROVIDER: "simulated", NODE_ENV: "production" }))).toBeNull();
    expect(await sendEmail(msg, env({ EMAIL_PROVIDER: "simulated", NODE_ENV: "production" }))).toEqual({ ok: false, reason: "not_configured" });
    expect(readSimulatedOutbox(env({ EMAIL_PROVIDER: "simulated" }))).toHaveLength(1);
  });

  it("sem provedor configurado não finge que enviou", async () => {
    expect(await sendEmail({ to: "a@x.test", subject: "s", text: "t" }, env({}))).toEqual({ ok: false, reason: "not_configured" });
  });

  it("resend: chama a API com a chave no cabeçalho, devolve falha clara e nunca loga o corpo", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const config = env({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_chave", EMAIL_FROM: "Aprova <a@x.test>" });
    expect(await sendEmail({ to: "b@x.test", subject: "s", text: "código 654321" }, config)).toEqual({ ok: true, provider: "resend" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.authorization).toBe("Bearer re_chave");
    expect(JSON.parse(init.body)).toMatchObject({ from: "Aprova <a@x.test>", to: ["b@x.test"] });

    fetchMock.mockResolvedValueOnce({ ok: false });
    expect(await sendEmail({ to: "b@x.test", subject: "s", text: "código 654321" }, config)).toEqual({ ok: false, reason: "failed" });
    fetchMock.mockRejectedValueOnce(new Error("rede"));
    expect(await sendEmail({ to: "b@x.test", subject: "s", text: "código 654321" }, config)).toEqual({ ok: false, reason: "failed" });
    for (const spy of [log, error]) expect(JSON.stringify(spy.mock.calls)).not.toContain("654321");
    vi.unstubAllGlobals();
  });
});
