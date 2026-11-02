// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const maybeSingle = vi.fn();
const supabase = {
  auth: { getUser: () => getUser() },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => maybeSingle() }) }) }),
};
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => supabase }));

const connection = vi.fn();
vi.mock("next/server", () => ({ connection: () => connection() }));

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

// O `cache` do React memoiza por requisição; nos testes cada chamada precisa ser nova.
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

import { getSessionState, requireAnyUser } from "@/lib/auth/session";

const USER_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const profile = {
  id: USER_ID,
  full_name: "Admin",
  email: "admin@luvicompany.com.br",
  role: "admin",
  organization_id: "0b8f2a6e-5d8c-4a3e-9f57-2f1a3c4d5e6f",
  active: true,
};
const networkError = { name: "AuthRetryableFetchError", status: 0, message: "fetch failed" };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_URL = "https://projeto-de-teste.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_" + "x".repeat(30);
  getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  maybeSingle.mockResolvedValue({ data: profile, error: null });
});

describe("getSessionState", () => {
  it("devolve o usuário quando há sessão e perfil ativo", async () => {
    const state = await getSessionState();
    expect(state).toMatchObject({ kind: "ok", user: { id: USER_ID, role: "admin", initials: "AD" } });
  });

  it("sem sessão é anônimo", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthSessionMissingError", status: 400 } });
    expect(await getSessionState()).toEqual({ kind: "anonymous" });
  });

  it("falha de rede no Auth é 'indisponível', não anônimo", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: networkError });
    expect(await getSessionState()).toEqual({ kind: "unavailable" });
  });

  it("erro de consulta do perfil é 'indisponível', não 'sem acesso'", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: "TypeError: fetch failed", code: "" } });
    expect(await getSessionState()).toEqual({ kind: "unavailable" });
  });

  it("perfil ausente (RLS) ou inativo é 'sem acesso'", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await getSessionState()).toEqual({ kind: "no-access" });
    maybeSingle.mockResolvedValue({ data: { ...profile, active: false }, error: null });
    expect(await getSessionState()).toEqual({ kind: "no-access" });
  });
});

describe("requireAnyUser", () => {
  it("decide por requisição (connection) antes de ler a sessão", async () => {
    await requireAnyUser();
    expect(connection).toHaveBeenCalledTimes(1);
  });

  it("anônimo vai ao login", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthSessionMissingError", status: 400 } });
    await expect(requireAnyUser()).rejects.toMatchObject({ to: "/login" });
  });

  it("indisponível falha fechado com erro, sem fingir logout", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: networkError });
    await expect(requireAnyUser()).rejects.toThrow(/indisponível/);
  });
});
