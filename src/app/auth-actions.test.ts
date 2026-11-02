// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Cliente Supabase falso, controlado por teste.
const auth = {
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
};
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth }) }));

const getSessionState = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionState: () => getSessionState() }));

// redirect() do Next interrompe a execução lançando um erro especial.
class RedirectError extends Error {
  constructor(public to: string) {
    super(`REDIRECT:${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectError(to);
  },
}));

import { signInAction, signOutAction } from "@/app/login/actions";
import { requestPasswordResetAction } from "@/app/esqueci-senha/actions";
import { updatePasswordAction } from "@/app/redefinir-senha/actions";

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
};
const redirectOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RedirectError) return error.to;
    throw error;
  }
  return null;
};
const okUser = (role: string) => ({ kind: "ok", user: { id: "u1", role } });

const SAVED = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_URL = "https://projeto-de-teste.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_" + "x".repeat(30);
  process.env.APP_URL = "http://localhost:3000";
  auth.signInWithPassword.mockResolvedValue({ error: null });
  auth.signOut.mockResolvedValue({ error: null });
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  auth.updateUser.mockResolvedValue({ error: null });
});
afterEach(() => {
  vi.unstubAllEnvs();
  process.env = { ...SAVED };
});

describe("signInAction", () => {
  const login = (extra: Record<string, string> = {}) =>
    signInAction({}, form({ email: "ana@empresa.com", password: "senha-correta-1", ...extra }));

  it("recusa quando o ambiente não está configurado", async () => {
    delete process.env.SUPABASE_URL;
    expect((await login()).error).toMatch(/não foi configurado/);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("valida e normaliza a entrada antes de chamar o Supabase", async () => {
    expect((await signInAction({}, form({ email: "nao-e-email", password: "x" }))).error).toMatch(/e-mail válido/);
    expect((await signInAction({}, form({ email: "ana@empresa.com", password: "" }))).error).toMatch(/e-mail válido/);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();

    getSessionState.mockResolvedValue(okUser("cliente"));
    await redirectOf(signInAction({}, form({ email: "  ANA@Empresa.COM ", password: "x" })));
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "ana@empresa.com", password: "x" });
  });

  it("usa a mesma mensagem para credenciais inválidas, sem enumerar contas", async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { status: 400, code: "invalid_credentials" } });
    const a = await login();
    auth.signInWithPassword.mockResolvedValue({ error: { status: 400, code: "user_not_found" } });
    const b = await login();
    expect(a.error).toBe("E-mail ou senha incorretos.");
    expect(b).toEqual(a);
  });

  it("informa indisponibilidade do serviço e limite de tentativas", async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { name: "AuthRetryableFetchError", status: 0 } });
    expect((await login()).error).toMatch(/serviço de autenticação/);
    auth.signInWithPassword.mockResolvedValue({ error: { status: 429, code: "over_request_rate_limit" } });
    expect((await login()).error).toMatch(/Muitas tentativas/);
  });

  it("encerra a sessão e nega quando não há perfil ativo", async () => {
    getSessionState.mockResolvedValue({ kind: "no-access" });
    const result = await login();
    expect(result.error).toMatch(/não tem acesso ativo/);
    expect(auth.signOut).toHaveBeenCalled();
  });

  it("o papel real decide o destino: equipe -> /admin, cliente -> /portal", async () => {
    getSessionState.mockResolvedValue(okUser("designer"));
    expect(await redirectOf(login())).toBe("/admin");
    getSessionState.mockResolvedValue(okUser("cliente"));
    expect(await redirectOf(login())).toBe("/portal");
  });

  it("respeita 'next' só quando é seguro e permitido para o papel", async () => {
    getSessionState.mockResolvedValue(okUser("designer"));
    expect(await redirectOf(login({ next: "/admin/clientes" }))).toBe("/admin/clientes");
    expect(await redirectOf(login({ next: "/portal" }))).toBe("/admin"); // equipe não entra no portal
    expect(await redirectOf(login({ next: "https://evil.example.com" }))).toBe("/admin");
    expect(await redirectOf(login({ next: "//evil.example.com" }))).toBe("/admin");
    getSessionState.mockResolvedValue(okUser("cliente"));
    expect(await redirectOf(login({ next: "/admin" }))).toBe("/portal"); // cliente não entra no painel
  });
});

describe("signOutAction", () => {
  it("encerra a sessão no servidor e volta ao login", async () => {
    expect(await redirectOf(signOutAction())).toBe("/login");
    expect(auth.signOut).toHaveBeenCalled();
  });
});

describe("requestPasswordResetAction", () => {
  const request = (email: string) => requestPasswordResetAction({}, form({ email }));

  it("valida o e-mail", async () => {
    expect((await request("invalido")).error).toMatch(/e-mail válido/);
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("em desenvolvimento, o link aponta para localhost", async () => {
    await request("ana@empresa.com");
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("ana@empresa.com", {
      redirectTo: "http://localhost:3000/auth/recovery",
    });
  });

  it("um APP_URL de produção copiado para o .env de desenvolvimento NÃO vira link de e-mail", async () => {
    process.env.APP_URL = "https://aprova.luvicompany.com.br";
    await request("ana@empresa.com");
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("ana@empresa.com", {
      redirectTo: "http://localhost:3000/auth/recovery",
    });
  });

  it("em produção usa o APP_URL https configurado", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.APP_URL = "https://aprova.luvicompany.com.br/";
    await request("ana@empresa.com");
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("ana@empresa.com", {
      redirectTo: "https://aprova.luvicompany.com.br/auth/recovery",
    });
  });

  it("em produção sem APP_URL válido, não envia link (falha fechado)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.APP_URL;
    const result = await request("ana@empresa.com");
    expect(result.error).toMatch(/não foi configurado/);
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("responde igual exista a conta ou não (não revela e-mails cadastrados)", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    const existe = await request("existe@empresa.com");
    auth.resetPasswordForEmail.mockResolvedValue({ error: { status: 400, code: "user_not_found" } });
    const naoExiste = await request("nao-existe@empresa.com");
    expect(existe).toEqual({ sent: true });
    expect(naoExiste).toEqual(existe);
  });

  it("avisa quando o serviço está fora do ar ou o limite foi atingido", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: { name: "AuthRetryableFetchError", status: 0 } });
    expect((await request("ana@empresa.com")).error).toMatch(/serviço de autenticação/);
    auth.resetPasswordForEmail.mockResolvedValue({ error: { status: 429, code: "over_email_send_rate_limit" } });
    expect((await request("ana@empresa.com")).error).toMatch(/Muitas tentativas/);
  });
});

describe("updatePasswordAction", () => {
  const update = (password: string, confirm = password) => updatePasswordAction({}, form({ password, confirm }));

  it("exige sessão de recuperação válida", async () => {
    getSessionState.mockResolvedValue({ kind: "anonymous" });
    expect((await update("Senha-nova-2026")).error).toMatch(/expirou/);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("aplica a política de senha e a confirmação", async () => {
    getSessionState.mockResolvedValue(okUser("cliente"));
    expect((await update("curta1")).error).toMatch(/ao menos 10/);
    expect((await update("Senha-nova-2026", "Senha-nova-2027")).error).toMatch(/não conferem/);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("troca a senha, encerra todas as sessões e manda para o login", async () => {
    getSessionState.mockResolvedValue(okUser("cliente"));
    expect(await redirectOf(update("Senha-nova-2026"))).toBe("/login?msg=senha-redefinida");
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "Senha-nova-2026" });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it("traduz erros do Supabase", async () => {
    getSessionState.mockResolvedValue(okUser("cliente"));
    auth.updateUser.mockResolvedValue({ error: { code: "same_password" } });
    expect((await update("Senha-nova-2026")).error).toMatch(/diferente da atual/);
    auth.updateUser.mockResolvedValue({ error: { code: "weak_password" } });
    expect((await update("Senha-nova-2026")).error).toMatch(/fraca/);
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});
