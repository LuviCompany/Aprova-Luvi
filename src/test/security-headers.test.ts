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
});
