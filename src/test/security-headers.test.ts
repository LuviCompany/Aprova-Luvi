// @vitest-environment node
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

/** Proteção do token na URL do link de aprovação: sem Referer, sem cache, sem indexação. */
describe("cabeçalhos de segurança", () => {
  it("/aprovar/* não envia Referer, não fica em cache e não é indexado; o resto mantém a política geral", async () => {
    const rules = await nextConfig.headers!();
    const link = rules.find((r) => r.source === "/aprovar/:path*");
    expect(link).toBeDefined();
    const map = Object.fromEntries(link!.headers.map((h) => [h.key, h.value]));
    expect(map["Referrer-Policy"]).toBe("no-referrer");
    expect(map["Cache-Control"]).toMatch(/no-store/);
    expect(map["X-Robots-Tag"]).toMatch(/noindex/);

    const general = rules.find((r) => r.source === "/:path*")!;
    const keys = general.headers.map((h) => h.key);
    expect(keys).toEqual(expect.arrayContaining(["X-Frame-Options", "X-Content-Type-Options", "Strict-Transport-Security"]));
    // a regra específica vem DEPOIS da geral (a última vence no conflito de Referrer-Policy)
    expect(rules.indexOf(link!)).toBeGreaterThan(rules.indexOf(general));
  });

  it("o log do servidor de desenvolvimento não registra argumentos de Server Functions nem as requisições de /aprovar", () => {
    expect(nextConfig.logging).toBeDefined();
    const logging = nextConfig.logging as { serverFunctions?: boolean; incomingRequests?: { ignore: RegExp[] } };
    expect(logging.serverFunctions).toBe(false);
    const ignore = logging.incomingRequests?.ignore ?? [];
    expect(ignore.some((re) => re.test("/aprovar/aE6wEtXsJsfyQPHi6IhH00b728T5Y2YB78s4oGaxa-E"))).toBe(true);
    expect(ignore.some((re) => re.test("/admin/materiais"))).toBe(false);
  });
});
