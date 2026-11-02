import { describe, expect, it } from "vitest";
import { classifyAuthError } from "@/lib/auth/errors";
import { validateNewPassword } from "@/lib/auth/password";
import { safeNextPath } from "@/lib/auth/redirect";
import { canAccessPath, homeForRole, isAppRole, isProtectedPath, isStaffRole } from "@/lib/auth/roles";
import { getSiteUrl, getSupabaseConfig, isDemoMode, isSupabaseConfigured, requireServiceRoleKey } from "@/lib/env";

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

describe("roles e acesso por perfil", () => {
  it("equipe vai para /admin e cliente para /portal", () => {
    expect(homeForRole("admin")).toBe("/admin");
    expect(homeForRole("designer")).toBe("/admin");
    expect(homeForRole("atendimento")).toBe("/admin");
    expect(homeForRole("cliente")).toBe("/portal");
  });

  it("cliente nunca acessa /admin, e a equipe nunca acessa /portal", () => {
    expect(canAccessPath("cliente", "/admin")).toBe(false);
    expect(canAccessPath("cliente", "/admin/materiais/m1")).toBe(false);
    expect(canAccessPath("designer", "/portal")).toBe(false);
    expect(canAccessPath("admin", "/portal/materiais")).toBe(false);
    expect(canAccessPath("designer", "/admin/clientes")).toBe(true);
    expect(canAccessPath("cliente", "/portal/historico")).toBe(true);
  });

  it("não confunde prefixos parecidos", () => {
    expect(canAccessPath("cliente", "/administrador")).toBe(true); // rota pública, não é /admin
    expect(isProtectedPath("/administrador")).toBe(false);
    expect(isProtectedPath("/portal-do-cliente")).toBe(false);
  });

  it("protege as áreas autenticadas e libera as públicas", () => {
    for (const p of ["/admin", "/admin/usuarios", "/portal", "/portal/materiais/x", "/redefinir-senha"]) {
      expect(isProtectedPath(p), p).toBe(true);
    }
    for (const p of ["/login", "/esqueci-senha", "/aprovar/abc", "/auth/confirm", "/"]) {
      expect(isProtectedPath(p), p).toBe(false);
    }
  });

  it("valida papéis desconhecidos", () => {
    expect(isAppRole("admin")).toBe(true);
    expect(isAppRole("superadmin")).toBe(false);
    expect(isAppRole(undefined)).toBe(false);
    expect(isStaffRole("cliente")).toBe(false);
  });
});

describe("safeNextPath (anti open-redirect)", () => {
  it("aceita caminhos internos das áreas autenticadas", () => {
    expect(safeNextPath("/admin", "/x")).toBe("/admin");
    expect(safeNextPath("/admin/materiais/m1?tab=1", "/x")).toBe("/admin/materiais/m1?tab=1");
    expect(safeNextPath("/portal", "/x")).toBe("/portal");
    expect(safeNextPath("/redefinir-senha", "/x")).toBe("/redefinir-senha");
  });

  it.each([
    "https://evil.example.com",
    "//evil.example.com",
    "/\\evil.example.com",
    "javascript:alert(1)",
    "/admin\\..\\evil",
    "/admin\n@evil.com",
    "/login",
    "/aprovar/token",
    "/administrador",
    "admin",
    "",
  ])("rejeita %j", (value) => {
    expect(safeNextPath(value, "/seguro")).toBe("/seguro");
  });

  it("usa o fallback quando não há valor", () => {
    expect(safeNextPath(null, "/portal")).toBe("/portal");
    expect(safeNextPath(undefined, "/portal")).toBe("/portal");
  });
});

describe("validateNewPassword", () => {
  it("aceita senha forte", () => {
    expect(validateNewPassword("Luvi2026segura")).toBeNull();
  });

  it.each([
    ["curta", "abc123"],
    ["sem número", "somenteletras"],
    ["sem letra", "1234567890123"],
    ["repetitiva", "aaaaaaaaa1aaa"],
    ["comum", "senha12345"],
    ["longa demais", "a1".repeat(40)],
  ])("rejeita senha %s", (_nome, senha) => {
    expect(validateNewPassword(senha)).not.toBeNull();
  });
});

describe("classifyAuthError", () => {
  it("separa falha de rede, limite de tentativas e erros de senha", () => {
    expect(classifyAuthError({ name: "AuthRetryableFetchError", status: 0 })).toBe("network");
    expect(classifyAuthError({ status: 503 })).toBe("network");
    expect(classifyAuthError({ status: 429 })).toBe("rate-limit");
    expect(classifyAuthError({ code: "over_email_send_rate_limit" })).toBe("rate-limit");
    expect(classifyAuthError({ code: "same_password" })).toBe("same-password");
    expect(classifyAuthError({ code: "weak_password" })).toBe("weak-password");
  });

  it("trata credencial inválida como 'other' (mensagem única, sem enumerar contas)", () => {
    expect(classifyAuthError({ status: 400, code: "invalid_credentials" })).toBe("other");
    expect(classifyAuthError(null)).toBe("other");
  });
});

describe("ambiente", () => {
  const configured = { SUPABASE_URL: "https://abc.supabase.co", SUPABASE_ANON_KEY: "anon" };

  it("só considera o Supabase configurado com URL e chave válidas", () => {
    expect(isSupabaseConfigured(env({}))).toBe(false);
    expect(isSupabaseConfigured(env({ SUPABASE_URL: "https://abc.supabase.co" }))).toBe(false);
    expect(isSupabaseConfigured(env(configured))).toBe(true);
    expect(getSupabaseConfig(env({ SUPABASE_URL: "not a url", SUPABASE_ANON_KEY: "k" }))).toBeNull();
  });

  it("recusa URL http fora de localhost (evita enviar sessão em texto puro)", () => {
    expect(getSupabaseConfig(env({ SUPABASE_URL: "http://abc.supabase.co", SUPABASE_ANON_KEY: "k" }))).toBeNull();
    expect(getSupabaseConfig(env({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_ANON_KEY: "k" }))).not.toBeNull();
  });

  it("modo demonstração exige opt-in explícito", () => {
    expect(isDemoMode(env({}))).toBe(false);
    expect(isDemoMode(env({ APROVA_DEMO_MODE: "true" }))).toBe(true);
    expect(isDemoMode(env({ APROVA_DEMO_MODE: "1" }))).toBe(false);
  });

  it("configurar o Supabase desliga a demonstração, mesmo com o opt-in esquecido ligado", () => {
    expect(isDemoMode(env({ APROVA_DEMO_MODE: "true", ...configured }))).toBe(false);
  });

  it("exige a chave de serviço quando pedida e nunca a inventa", () => {
    expect(() => requireServiceRoleKey(env({}))).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(requireServiceRoleKey(env({ SUPABASE_SERVICE_ROLE_KEY: "k" }))).toBe("k");
  });

  it("normaliza a URL pública do app", () => {
    expect(getSiteUrl(env({ NEXT_PUBLIC_APP_URL: "https://aprova.luvicompany.com.br///" }))).toBe(
      "https://aprova.luvicompany.com.br",
    );
    expect(getSiteUrl(env({}))).toBe("http://localhost:3000");
  });
});
