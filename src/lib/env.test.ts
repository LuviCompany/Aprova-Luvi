import { describe, expect, it } from "vitest";
import {
  classifyKey,
  diagnoseEnv,
  getEmailProviderConfig,
  getSiteUrl,
  getSupabaseConfig,
  isDemoMode,
  isSupabaseConfigured,
  requireLinkSecret,
  requireSecretKey,
} from "@/lib/env";

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

const PUB = "sb_publishable_" + "x".repeat(30);
const SEC = "sb_secret_" + "y".repeat(30);
const jwt = (role: string) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.assinatura-de-teste`;

describe("classifyKey", () => {
  it("reconhece as chaves novas e as legadas pelo conteúdo, sem confiar no nome da variável", () => {
    expect(classifyKey(PUB)).toBe("publishable");
    expect(classifyKey(SEC)).toBe("secret");
    expect(classifyKey(jwt("anon"))).toBe("legacy-anon");
    expect(classifyKey(jwt("service_role"))).toBe("legacy-service-role");
  });

  it("trata lixo, vazio e JWT de outro papel como desconhecido", () => {
    for (const v of ["", undefined, null, "anon", "sb_publishable_", "sb_secret_x", jwt("authenticated"), "eyJabc.def.ghi"]) {
      expect(classifyKey(v as string), String(v)).toBe("unknown");
    }
  });
});

describe("ambiente", () => {
  const configured = { SUPABASE_URL: "https://abc.supabase.co", SUPABASE_PUBLISHABLE_KEY: PUB };

  it("só considera o Supabase configurado com URL e chave pública válidas", () => {
    expect(isSupabaseConfigured(env({}))).toBe(false);
    expect(isSupabaseConfigured(env({ SUPABASE_URL: "https://abc.supabase.co" }))).toBe(false);
    expect(isSupabaseConfigured(env(configured))).toBe(true);
    expect(getSupabaseConfig(env({ SUPABASE_URL: "not a url", SUPABASE_PUBLISHABLE_KEY: PUB }))).toBeNull();
    expect(getSupabaseConfig(env({ SUPABASE_URL: "https://abc.supabase.co", SUPABASE_PUBLISHABLE_KEY: "lixo" }))).toBeNull();
  });

  it("aceita a chave anon legada como reserva, com a variável legada", () => {
    expect(getSupabaseConfig(env({ SUPABASE_URL: "https://abc.supabase.co", SUPABASE_ANON_KEY: jwt("anon") }))).not.toBeNull();
  });

  it("a variável nova tem prioridade sobre a legada", () => {
    const cfg = getSupabaseConfig(
      env({ SUPABASE_URL: "https://abc.supabase.co", SUPABASE_PUBLISHABLE_KEY: PUB, SUPABASE_ANON_KEY: jwt("anon") }),
    );
    expect(cfg?.publishableKey).toBe(PUB);
  });

  it("RECUSA uma chave secreta colocada na variável pública (não sobe com a chave errada)", () => {
    expect(getSupabaseConfig(env({ SUPABASE_URL: "https://abc.supabase.co", SUPABASE_PUBLISHABLE_KEY: SEC }))).toBeNull();
    expect(getSupabaseConfig(env({ SUPABASE_URL: "https://abc.supabase.co", SUPABASE_ANON_KEY: jwt("service_role") }))).toBeNull();
  });

  it("recusa URL http fora de localhost (evita enviar sessão em texto puro)", () => {
    expect(getSupabaseConfig(env({ SUPABASE_URL: "http://abc.supabase.co", SUPABASE_PUBLISHABLE_KEY: PUB }))).toBeNull();
    expect(getSupabaseConfig(env({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_PUBLISHABLE_KEY: PUB }))).not.toBeNull();
  });

  it("modo demonstração exige opt-in explícito", () => {
    expect(isDemoMode(env({}))).toBe(false);
    expect(isDemoMode(env({ APROVA_DEMO_MODE: "true" }))).toBe(true);
    expect(isDemoMode(env({ APROVA_DEMO_MODE: "1" }))).toBe(false);
  });

  it("configurar o Supabase desliga a demonstração, mesmo com o opt-in esquecido ligado", () => {
    expect(isDemoMode(env({ APROVA_DEMO_MODE: "true", ...configured }))).toBe(false);
  });

  it("a chave secreta exige o tipo certo e nunca é inventada", () => {
    expect(() => requireSecretKey(env({}))).toThrow(/SUPABASE_SECRET_KEY/);
    expect(() => requireSecretKey(env({ SUPABASE_SECRET_KEY: PUB }))).toThrow(/SUPABASE_SECRET_KEY/);
    expect(() => requireSecretKey(env({ SUPABASE_SECRET_KEY: jwt("anon") }))).toThrow();
    expect(requireSecretKey(env({ SUPABASE_SECRET_KEY: SEC }))).toBe(SEC);
    expect(requireSecretKey(env({ SUPABASE_SERVICE_ROLE_KEY: jwt("service_role") }))).toContain("eyJ");
  });
});

describe("getSiteUrl (links de e-mail nunca apontam para outro ambiente)", () => {
  it("desenvolvimento: usa localhost e ignora qualquer endereço de fora", () => {
    expect(getSiteUrl(env({}))).toBe("http://localhost:3000");
    expect(getSiteUrl(env({ APP_URL: "http://localhost:4000/" }))).toBe("http://localhost:4000");
    expect(getSiteUrl(env({ APP_URL: "https://aprova.luvicompany.com.br" }))).toBe("http://localhost:3000");
    expect(getSiteUrl(env({ NEXT_PUBLIC_APP_URL: "https://aprova.luvicompany.com.br" }))).toBe("http://localhost:3000");
  });

  it("produção: exige https e normaliza; sem valor válido devolve null", () => {
    const prod = { NODE_ENV: "production" };
    expect(getSiteUrl(env({ ...prod, APP_URL: "https://aprova.luvicompany.com.br///" }))).toBe("https://aprova.luvicompany.com.br");
    expect(getSiteUrl(env({ ...prod, APP_URL: "https://aprova.luvicompany.com.br/admin?x=1" }))).toBe("https://aprova.luvicompany.com.br");
    expect(getSiteUrl(env(prod))).toBeNull();
    expect(getSiteUrl(env({ ...prod, APP_URL: "http://aprova.luvicompany.com.br" }))).toBeNull();
    expect(getSiteUrl(env({ ...prod, APP_URL: "javascript:alert(1)" }))).toBeNull();
    expect(getSiteUrl(env({ ...prod, APP_URL: "lixo" }))).toBeNull();
  });

  it("produção local (next start / testes) aceita http://localhost", () => {
    expect(getSiteUrl(env({ NODE_ENV: "production", APP_URL: "http://localhost:3101" }))).toBe("http://localhost:3101");
  });

  it("APP_URL tem prioridade sobre a variável legada NEXT_PUBLIC_APP_URL", () => {
    expect(
      getSiteUrl(env({ NODE_ENV: "production", APP_URL: "https://novo.example.com", NEXT_PUBLIC_APP_URL: "https://velho.example.com" })),
    ).toBe("https://novo.example.com");
  });
});

describe("diagnoseEnv (npm run env:check)", () => {
  const good = {
    SUPABASE_URL: "https://abc.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: PUB,
    SUPABASE_SECRET_KEY: SEC,
    APPROVAL_LINK_SECRET: "s".repeat(40),
    EMAIL_PROVIDER: "simulated",
  };

  it("aprova uma configuração correta com chaves novas, sem avisos", () => {
    const d = diagnoseEnv(env(good));
    expect(d.ok).toBe(true);
    expect(d.errors).toEqual([]);
    expect(d.warnings).toEqual([]);
    expect(d.summary).toMatchObject({ supabaseHost: "abc.supabase.co", publishableKey: "publishable", secretKey: "secret" });
  });

  it("nunca devolve o valor de uma chave", () => {
    const text = JSON.stringify(diagnoseEnv(env(good)));
    expect(text).not.toContain("xxxxxxxx");
    expect(text).not.toContain("yyyyyyyy");
  });

  it("acusa chave secreta na variável pública e chave pública na secreta", () => {
    expect(diagnoseEnv(env({ ...good, SUPABASE_PUBLISHABLE_KEY: SEC })).errors.join(" ")).toMatch(/contém uma chave SECRETA/);
    expect(diagnoseEnv(env({ ...good, SUPABASE_SECRET_KEY: PUB })).errors.join(" ")).toMatch(/contém uma chave PÚBLICA/);
  });

  it("avisa sobre chaves e nomes legados", () => {
    const d = diagnoseEnv(
      env({ SUPABASE_URL: "https://abc.supabase.co", SUPABASE_ANON_KEY: jwt("anon"), SUPABASE_SERVICE_ROLE_KEY: jwt("service_role") }),
    );
    expect(d.ok).toBe(true);
    expect(d.warnings.join(" ")).toMatch(/legada/);
  });

  it("avisa quando APP_URL de produção aparece em desenvolvimento e quando a demo é ignorada", () => {
    const d = diagnoseEnv(env({ ...good, APP_URL: "https://aprova.luvicompany.com.br", APROVA_DEMO_MODE: "true" }));
    expect(d.warnings.join(" ")).toMatch(/foi ignorada/);
    expect(d.warnings.join(" ")).toMatch(/APROVA_DEMO_MODE=true será ignorado/);
  });

  it("em produção, sem APP_URL https é erro", () => {
    expect(diagnoseEnv(env({ ...good, NODE_ENV: "production" })).errors.join(" ")).toMatch(/APP_URL/);
  });
});

describe("aprovação por link: segredo e provedor de e-mail", () => {
  it("o segredo do link exige 32+ caracteres e falha alto, sem vazar o valor", () => {
    expect(requireLinkSecret(env({ APPROVAL_LINK_SECRET: "a".repeat(32) }))).toBe("a".repeat(32));
    for (const bad of [undefined, "", "curto", "a".repeat(31)]) {
      const values: Record<string, string> = bad === undefined ? {} : { APPROVAL_LINK_SECRET: bad };
      expect(() => requireLinkSecret(env(values)), String(bad)).toThrow(/APPROVAL_LINK_SECRET/);
    }
  });

  it("o provedor simulado vale fora de produção e é RECUSADO em produção", () => {
    expect(getEmailProviderConfig(env({ EMAIL_PROVIDER: "simulated" }))).toEqual({ kind: "simulated" });
    const prod = getEmailProviderConfig(env({ EMAIL_PROVIDER: "simulated", NODE_ENV: "production" }));
    expect(prod.kind).toBe("none");
  });

  it("o simulado em produção só passa no teste de ponta a ponta: flag explícita E APP_URL de localhost", () => {
    const prod = { EMAIL_PROVIDER: "simulated", NODE_ENV: "production" };
    expect(getEmailProviderConfig(env({ ...prod, E2E_SIMULATED_EMAIL: "true", APP_URL: "http://localhost:3103" }))).toEqual({ kind: "simulated" });
    // a flag sozinha, ou com domínio público, ou com valor diferente de "true", não abre nada
    expect(getEmailProviderConfig(env({ ...prod, E2E_SIMULATED_EMAIL: "true" })).kind).toBe("none");
    expect(getEmailProviderConfig(env({ ...prod, E2E_SIMULATED_EMAIL: "true", APP_URL: "https://aprova.luvicompany.com.br" })).kind).toBe("none");
    expect(getEmailProviderConfig(env({ ...prod, E2E_SIMULATED_EMAIL: "1", APP_URL: "http://localhost:3103" })).kind).toBe("none");
    expect(getEmailProviderConfig(env({ ...prod, APP_URL: "http://localhost:3103" })).kind).toBe("none");
  });

  it("resend exige chave e remetente; sem provedor configurado nada é enviado", () => {
    expect(getEmailProviderConfig(env({ EMAIL_PROVIDER: "resend" })).kind).toBe("none");
    expect(getEmailProviderConfig(env({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_x" })).kind).toBe("none");
    expect(getEmailProviderConfig(env({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_x", EMAIL_FROM: "A <a@x.test>" }))).toEqual({
      kind: "resend",
      apiKey: "re_x",
      from: "A <a@x.test>",
    });
    expect(getEmailProviderConfig(env({})).kind).toBe("none");
    expect(getEmailProviderConfig(env({ EMAIL_PROVIDER: "smtp-qualquer" })).kind).toBe("none");
  });

  it("o diagnóstico avisa quando falta o segredo ou o provedor e não vaza o segredo", () => {
    const base = { SUPABASE_URL: "https://abc.supabase.co", SUPABASE_PUBLISHABLE_KEY: PUB, SUPABASE_SECRET_KEY: SEC };
    const d = diagnoseEnv(env(base));
    expect(d.ok).toBe(true);
    expect(d.warnings.join(" ")).toMatch(/APPROVAL_LINK_SECRET/);
    expect(d.warnings.join(" ")).toMatch(/E-mail/);
    const full = diagnoseEnv(env({ ...base, APPROVAL_LINK_SECRET: "z".repeat(40), EMAIL_PROVIDER: "simulated" }));
    expect(JSON.stringify(full)).not.toContain("zzzzzzzz");
    expect(full.summary).toMatchObject({ linkSecret: "definido", emailProvider: "simulated" });
  });
});
