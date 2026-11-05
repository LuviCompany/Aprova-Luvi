// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { buildContentSecurityPolicy, withSecurityHeaders } from "@/lib/security-headers";

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;
const directives = (csp: string) => Object.fromEntries(csp.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)]));

const SAVED = { ...process.env };
afterEach(() => {
  process.env = { ...SAVED };
});

describe("Content-Security-Policy", () => {
  it("em produção: só o próprio app e o projeto Supabase; sem eval; sem moldura, plugin nem <base> alheio", () => {
    const csp = directives(buildContentSecurityPolicy(env({ NODE_ENV: "production", SUPABASE_URL: "https://abc.supabase.co/rest/v1" })));
    expect(csp["default-src"]).toEqual(["'self'"]);
    expect(csp["script-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(csp["script-src"]).not.toContain("'unsafe-eval'");
    expect(csp["connect-src"]).toEqual(["'self'", "https://abc.supabase.co"]);
    expect(csp["img-src"]).toEqual(["'self'", "data:", "blob:", "https://abc.supabase.co"]);
    expect(csp["media-src"]).toEqual(["'self'", "blob:", "https://abc.supabase.co"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'self'"]);
    expect(csp["form-action"]).toEqual(["'self'"]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
  });

  it("nenhuma diretiva abre para curinga ou para qualquer https", () => {
    const text = buildContentSecurityPolicy(env({ NODE_ENV: "production", SUPABASE_URL: "https://abc.supabase.co" }));
    expect(text).not.toMatch(/ \* |\*;|https:(;| )/);
  });

  it("em desenvolvimento libera eval e websocket (recarga do Next); sem SUPABASE_URL não inventa origem", () => {
    const dev = directives(buildContentSecurityPolicy(env({ NODE_ENV: "development", SUPABASE_URL: "http://127.0.0.1:54321" })));
    expect(dev["script-src"]).toContain("'unsafe-eval'");
    expect(dev["connect-src"]).toEqual(expect.arrayContaining(["'self'", "http://127.0.0.1:54321", "ws:", "wss:"]));
    const none = directives(buildContentSecurityPolicy(env({ NODE_ENV: "production" })));
    expect(none["connect-src"]).toEqual(["'self'"]);
    expect(none["img-src"]).toEqual(["'self'", "data:", "blob:"]);
  });
});

describe("a CSP sai em toda resposta do proxy", () => {
  it("em redirecionamento, em passagem normal e na demonstração", async () => {
    process.env.SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_" + "x".repeat(30);
    delete process.env.APROVA_DEMO_MODE;
    for (const path of ["/admin", "/login", "/aprovar/qualquer"]) {
      const res = await proxy(new NextRequest(new URL(path, "http://localhost:3000")));
      expect(res.headers.get("content-security-policy"), path).toMatch(/frame-ancestors 'none'/);
    }
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    process.env.APROVA_DEMO_MODE = "true";
    expect((await proxy(new NextRequest(new URL("/login", "http://localhost:3000")))).headers.get("content-security-policy")).toMatch(/default-src 'self'/);
  });

  it("withSecurityHeaders só acrescenta a CSP", () => {
    const res = withSecurityHeaders(new Response(null, { headers: { "x-teste": "1" } }), env({ NODE_ENV: "production" }));
    expect(res.headers.get("x-teste")).toBe("1");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
  });
});
