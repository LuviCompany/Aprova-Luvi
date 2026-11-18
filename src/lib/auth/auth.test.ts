import { describe, expect, it } from "vitest";
import { classifyAuthError } from "@/lib/auth/errors";
import { MIN_PASSWORD_LENGTH, PASSWORD_RULE_HINT, PASSWORD_SYMBOLS, validateNewPassword } from "@/lib/auth/password";
import { safeNextPath } from "@/lib/auth/redirect";
import { canAccessPath, homeForRole, isAppRole, isProtectedPath, isStaffRole } from "@/lib/auth/roles";


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
  it.each(["Luvi2026segura!", "Senha-nova-2026", "Abcdefghij1#", "aB3$aB3$aB3$"])("aceita senha forte (%s)", (senha) => {
    expect(validateNewPassword(senha)).toBeNull();
  });

  it("exige 12 caracteres, maiúscula, minúscula, número e símbolo, na mesma regra do Supabase de produção", () => {
    expect(validateNewPassword("Abcdefgh1!x")).toMatch(/ao menos 12/); // 11 caracteres
    expect(validateNewPassword("ABCDEFGH1234!")).toMatch(/minúscula/);
    expect(validateNewPassword("abcdefgh1234!")).toMatch(/maiúscula/);
    expect(validateNewPassword("Abcdefghijkl!")).toMatch(/número/);
    expect(validateNewPassword("Abcdefghij12")).toMatch(/símbolo/);
    expect(validateNewPassword("Abcdefghij1 ")).toMatch(/símbolo/); // espaço não é símbolo
  });

  it("todos os símbolos da política do Supabase contam como símbolo", () => {
    for (const symbol of PASSWORD_SYMBOLS) {
      expect(validateNewPassword(`Abcdefghij1${symbol}`), symbol).toBeNull();
    }
  });

  it.each([
    ["curta", "Abc1!"],
    ["sem número", "Somenteletras!"],
    ["sem letra", "1234567890123!"],
    ["só letras e números", "Luvi2026segura"],
    ["comum, sem símbolo", "Password1234"],
    ["longa demais", "aB1!".repeat(20)],
  ])("rejeita senha %s", (_nome, senha) => {
    expect(validateNewPassword(senha)).not.toBeNull();
  });

  it("o texto de ajuda dos formulários descreve a mesma regra", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(PASSWORD_RULE_HINT).toMatch(/12 caracteres.*maiúsculas e minúsculas.*números e símbolos/);
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
