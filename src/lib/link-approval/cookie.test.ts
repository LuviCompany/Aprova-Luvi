// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Cookie da sessão do link: atributos de segurança, nome que não vaza o token e leitura tolerante a lixo. */

const set = vi.fn();
const get = vi.fn();
let requestHeaders: Record<string, string> = {};
vi.mock("next/headers", () => ({
  cookies: async () => ({ set, get }),
  headers: async () => ({ get: (name: string) => requestHeaders[name.toLowerCase()] ?? null }),
}));

import { SESSION_MAX_AGE, readSessionId, requestFingerprint, writeSessionId } from "@/lib/link-approval/cookie";
import { generateToken } from "@/lib/approval/token";

const SAVED = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  requestHeaders = {};
});
afterEach(() => {
  process.env = { ...SAVED };
});

describe("cookie da sessão do link", () => {
  it("é httpOnly, SameSite, restrito a /aprovar e dura 30 minutos; o nome não contém o token", async () => {
    const token = generateToken();
    await writeSessionId(token, "s".repeat(43));
    const [name, value, options] = set.mock.calls[0];
    expect(name).toMatch(/^aprova_lnk_[0-9a-f]{16}$/);
    expect(name).not.toContain(token.slice(0, 10));
    expect(value).toBe("s".repeat(43));
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/aprovar", maxAge: 1800 });
    expect(SESSION_MAX_AGE).toBe(1800);
  });

  it("só é Secure em produção", async () => {
    const token = generateToken();
    vi.stubEnv("NODE_ENV", "production");
    await writeSessionId(token, "s".repeat(43));
    expect(set.mock.calls[0][2].secure).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    await writeSessionId(token, "s".repeat(43));
    expect(set.mock.calls[1][2].secure).toBe(false);
    vi.unstubAllEnvs();
  });

  it("cada link tem o seu cookie; token impossível não lê nem grava nada", async () => {
    const a = generateToken();
    const b = generateToken();
    await writeSessionId(a, "x".repeat(43));
    await writeSessionId(b, "x".repeat(43));
    expect(set.mock.calls[0][0]).not.toBe(set.mock.calls[1][0]);
    get.mockReturnValue({ value: "valor" });
    expect(await readSessionId("../../etc")).toBeUndefined();
    expect(get).not.toHaveBeenCalled();
    expect(await readSessionId(a)).toBe("valor");
    expect(get).toHaveBeenCalledWith(set.mock.calls[0][0]);
  });
});

describe("requestFingerprint", () => {
  it("usa o primeiro IP de x-forwarded-for e limita o que é tratado como user-agent", async () => {
    requestHeaders = { "x-forwarded-for": "203.0.113.9, 10.0.0.1", "user-agent": "UA" };
    expect(await requestFingerprint()).toEqual({ ip: "203.0.113.9", userAgent: "UA" });
    requestHeaders = {};
    expect(await requestFingerprint()).toEqual({ ip: "desconhecido", userAgent: "" });
  });
});
