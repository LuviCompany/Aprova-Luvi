// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = { verifyOtp: vi.fn(), exchangeCodeForSession: vi.fn() };
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth }) }));

import { GET } from "@/app/auth/[purpose]/route";

const call = (purpose: string, query = "") =>
  GET(new NextRequest(new URL(`/auth/${purpose}${query}`, "http://localhost:3000")), {
    params: Promise.resolve({ purpose }),
  });
const to = (res: Response) => {
  const url = new URL(res.headers.get("location") ?? "", "http://localhost:3000");
  return `${url.pathname}${url.search}`;
};

const SAVED = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_URL = "https://projeto-de-teste.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_" + "x".repeat(30);
  auth.verifyOtp.mockResolvedValue({ error: null });
  auth.exchangeCodeForSession.mockResolvedValue({ error: null });
});
afterEach(() => {
  process.env = { ...SAVED };
});

describe("/auth/[purpose]: fluxo por code (modelo de e-mail padrão do Supabase)", () => {
  it("recuperação com code troca por sessão e vai para /redefinir-senha", async () => {
    const res = await call("recovery", "?code=abc123");
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc123");
    expect(to(res)).toBe("/redefinir-senha");
  });

  it("convite com code também termina em /redefinir-senha", async () => {
    expect(to(await call("invite", "?code=abc123"))).toBe("/redefinir-senha");
  });

  it("recuperação e convite ignoram `next` (não dá para desviar o destino)", async () => {
    expect(to(await call("recovery", "?code=abc&next=/admin"))).toBe("/redefinir-senha");
    expect(to(await call("invite", "?code=abc&next=https://evil.example.com"))).toBe("/redefinir-senha");
  });

  it("/auth/confirm genérico respeita `next` só se for seguro", async () => {
    expect(to(await call("confirm", "?code=abc&next=/admin/clientes"))).toBe("/admin/clientes");
    expect(to(await call("confirm", "?code=abc&next=https://evil.example.com"))).toBe("/login");
    expect(to(await call("confirm", "?code=abc&next=//evil.example.com"))).toBe("/login");
    expect(to(await call("confirm", "?code=abc"))).toBe("/login");
  });
});

describe("/auth/[purpose]: fluxo por token_hash (modelo de e-mail do projeto)", () => {
  it("valida o token e vai para /redefinir-senha em recuperação e convite", async () => {
    for (const type of ["recovery", "invite"]) {
      auth.verifyOtp.mockClear();
      const res = await call("confirm", `?token_hash=hash123&type=${type}&next=/admin`);
      expect(auth.verifyOtp).toHaveBeenCalledWith({ type, token_hash: "hash123" });
      expect(to(res), type).toBe("/redefinir-senha");
    }
  });

  it("recusa tipos fora da lista (magiclink, signup, email_change…) sem chamar o Supabase", async () => {
    for (const type of ["magiclink", "signup", "email_change", "sms", "x"]) {
      const res = await call("recovery", `?token_hash=hash123&type=${type}`);
      expect(to(res), type).toBe("/login?erro=link-invalido");
    }
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });
});

describe("/auth/[purpose]: falhas", () => {
  it("link expirado ou já usado (erro do Supabase) volta ao login com aviso", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: { code: "otp_expired" } });
    expect(to(await call("recovery", "?code=velho"))).toBe("/login?erro=link-invalido");
    auth.verifyOtp.mockResolvedValue({ error: { code: "otp_expired" } });
    expect(to(await call("invite", "?token_hash=velho&type=invite"))).toBe("/login?erro=link-invalido");
  });

  it("sem parâmetros (ex.: o Supabase devolveu o erro no fragmento da URL) volta ao login", async () => {
    expect(to(await call("recovery"))).toBe("/login?erro=link-invalido");
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("ambiente sem Supabase configurado falha fechado", async () => {
    delete process.env.SUPABASE_URL;
    expect(to(await call("recovery", "?code=abc"))).toBe("/login?erro=config");
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("finalidade desconhecida responde 404", async () => {
    expect((await call("qualquer-coisa", "?code=abc")).status).toBe(404);
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
