import { describe, expect, it } from "vitest";
import { validateLogin } from "@/components/login-form";

describe("validateLogin", () => {
  it("aceita e-mail válido e senha com 6 caracteres ou mais", () => {
    expect(validateLogin("ana@empresa.com.br", "123456")).toEqual({});
  });

  it("rejeita e-mail sem domínio", () => {
    expect(validateLogin("ana@empresa", "123456").email).toBeDefined();
  });

  it("rejeita e-mail com espaços internos", () => {
    expect(validateLogin("ana silva@empresa.com", "123456").email).toBeDefined();
  });

  it("rejeita senha curta", () => {
    expect(validateLogin("ana@empresa.com", "12345").password).toBeDefined();
  });

  it("ignora espaços nas pontas do e-mail", () => {
    expect(validateLogin("  ana@empresa.com  ", "123456").email).toBeUndefined();
  });
});
