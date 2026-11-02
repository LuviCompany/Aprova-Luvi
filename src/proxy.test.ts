// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

const make = (path: string) => new NextRequest(new URL(path, "http://localhost:3000"));
const locationOf = (res: Response) => new URL(res.headers.get("location") ?? "", "http://localhost:3000");

const SAVED = { ...process.env };
afterEach(() => {
  process.env = { ...SAVED };
});

describe("proxy com Supabase configurado e sem sessão", () => {
  beforeEach(() => {
    delete process.env.APROVA_DEMO_MODE;
    // Endereço local inexistente: getClaims() sem cookie nem chega a abrir conexão.
    process.env.SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_ANON_KEY = "chave-anon-de-teste";
  });

  it.each(["/admin", "/admin/materiais/m1", "/portal", "/portal/historico", "/redefinir-senha"])(
    "redireciona anônimo de %s para o login, guardando o destino",
    async (path) => {
      const res = await proxy(make(path));
      expect(res.status).toBe(307);
      const to = locationOf(res);
      expect(to.pathname).toBe("/login");
      expect(to.searchParams.get("next")).toBe(path);
    },
  );

  it("preserva a query string no destino", async () => {
    const res = await proxy(make("/admin/materiais?status=aguardando"));
    expect(locationOf(res).searchParams.get("next")).toBe("/admin/materiais?status=aguardando");
  });

  it.each(["/login", "/esqueci-senha", "/aprovar/qualquer-token", "/auth/confirm", "/"])(
    "deixa %s passar sem login",
    async (path) => {
      const res = await proxy(make(path));
      expect(res.headers.get("location")).toBeNull();
    },
  );
});

describe("proxy sem Supabase configurado e fora do modo demonstração", () => {
  it("falha fechado: áreas protegidas vão para o login", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.APROVA_DEMO_MODE;
    const res = await proxy(make("/admin"));
    expect(locationOf(res).pathname).toBe("/login");
  });
});

describe("proxy em modo demonstração", () => {
  it("não exige sessão (comportamento da Fase 1)", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    process.env.APROVA_DEMO_MODE = "true";
    const res = await proxy(make("/admin"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("é desligado se o Supabase for configurado, mesmo com o opt-in ligado", async () => {
    process.env.APROVA_DEMO_MODE = "true";
    process.env.SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_ANON_KEY = "chave-anon-de-teste";
    const res = await proxy(make("/portal"));
    expect(locationOf(res).pathname).toBe("/login");
  });
});
