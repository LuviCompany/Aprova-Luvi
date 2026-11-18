import { describe, expect, it } from "vitest";
import { diagnoseEnv, PRODUCTION_APP_HOST, PRODUCTION_SUPABASE_HOST } from "@/lib/env";

/** `npm run env:check -- --production`: o que é aviso em desenvolvimento vira ERRO no lançamento. */

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;
const PUB = "sb_publishable_" + "x".repeat(30);
const SEC = "sb_secret_" + "y".repeat(30);

const ready = {
  SUPABASE_URL: `https://${PRODUCTION_SUPABASE_HOST}`,
  SUPABASE_PUBLISHABLE_KEY: PUB,
  SUPABASE_SECRET_KEY: SEC,
  APP_URL: "https://aprova.luvicompany.com.br",
  APPROVAL_LINK_SECRET: "k".repeat(48),
  EMAIL_PROVIDER: "resend",
  RESEND_API_KEY: "re_chave_de_teste",
  EMAIL_FROM: "Aprova Luvi <aprovacao@luvicompany.com.br>",
};

describe("diagnoseEnv em modo produção", () => {
  it("uma configuração completa passa, sem erros", () => {
    const d = diagnoseEnv(env(ready), { production: true });
    expect(d.errors).toEqual([]);
    expect(d.ok).toBe(true);
    expect(d.summary).toMatchObject({ emailProvider: "resend", linkSecret: "definido" });
  });

  it("não vaza nenhum valor secreto no resultado", () => {
    const text = JSON.stringify(diagnoseEnv(env(ready), { production: true }));
    for (const secret of [SEC, PUB, "k".repeat(48), "re_chave_de_teste"]) expect(text).not.toContain(secret);
  });

  it("cada item que falta ou é de desenvolvimento vira erro", () => {
    const casos: Array<[Record<string, string>, RegExp]> = [
      [{ SUPABASE_SECRET_KEY: "" }, /SUPABASE_SECRET_KEY é obrigatória/],
      [{ APPROVAL_LINK_SECRET: "curto" }, /APPROVAL_LINK_SECRET/],
      [{ EMAIL_PROVIDER: "simulated" }, /EMAIL_PROVIDER=resend/],
      [{ EMAIL_PROVIDER: "" }, /EMAIL_PROVIDER=resend/],
      [{ RESEND_API_KEY: "" }, /EMAIL_PROVIDER=resend/],
      [{ EMAIL_FROM: "" }, /EMAIL_PROVIDER=resend/],
      [{ E2E_SIMULATED_EMAIL: "true" }, /E2E_SIMULATED_EMAIL não pode/],
      [{ APROVA_DEMO_MODE: "true" }, /APROVA_DEMO_MODE=true não pode/],
      [{ APP_URL: "http://aprova.luvicompany.com.br" }, /APP_URL de produção precisa ser https/],
      [{ APP_URL: "https://localhost:3000" }, /APP_URL de produção precisa ser https/],
      [{ APP_URL: "" }, /APP_URL/],
      [{ SUPABASE_URL: "http://localhost:54321" }, /localhost/],
    ];
    // (os casos de projeto/domínio errados têm teste próprio abaixo)
    for (const [patch, expected] of casos) {
      const d = diagnoseEnv(env({ ...ready, ...patch }), { production: true });
      expect(d.ok, JSON.stringify(Object.keys(patch))).toBe(false);
      expect(d.errors.join(" | "), JSON.stringify(Object.keys(patch))).toMatch(expected);
    }
  });

  it("TRAVA: o Supabase de desenvolvimento (ou qualquer outro projeto) e domínios fora do oficial viram erro", () => {
    // projeto de desenvolvimento, montado em partes para a URL completa do .env.local nunca entrar num commit
    const dev = ["https://", "kswnwootbdzlhdvbhhpk", ".supabase.co"].join("");
    for (const url of [dev, "https://abcdefghijklmnop.supabase.co"]) {
      const d = diagnoseEnv(env({ ...ready, SUPABASE_URL: url }), { production: true });
      expect(d.ok, url).toBe(false);
      expect(d.errors.join(" | ")).toMatch(/precisa ser o projeto de PRODUÇÃO/);
    }
    const d = diagnoseEnv(env({ ...ready, APP_URL: "https://outro-dominio.vercel.app" }), { production: true });
    expect(d.ok).toBe(false);
    expect(d.errors.join(" | ")).toMatch(new RegExp(`APP_URL precisa ser https://${PRODUCTION_APP_HOST.replace(/\./g, "\\.")}`));
    // o par oficial passa, em maiúsculas também
    expect(diagnoseEnv(env({ ...ready, SUPABASE_URL: `https://${PRODUCTION_SUPABASE_HOST.toUpperCase()}` }), { production: true }).ok).toBe(true);
  });

  it("sem a opção, o mesmo ambiente de desenvolvimento só gera avisos (modo padrão não muda)", () => {
    const dev = { SUPABASE_URL: ready.SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: PUB, SUPABASE_SECRET_KEY: SEC };
    const d = diagnoseEnv(env(dev));
    expect(d.ok).toBe(true);
    expect(d.warnings.join(" ")).toMatch(/APPROVAL_LINK_SECRET/);
  });

  it("NODE_ENV=production liga a checagem sozinho", () => {
    expect(diagnoseEnv(env({ ...ready, NODE_ENV: "production", EMAIL_PROVIDER: "simulated" })).ok).toBe(false);
  });
});
