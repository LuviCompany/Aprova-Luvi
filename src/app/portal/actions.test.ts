// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** selectCompanyAction: a escolha é validada no servidor contra os vínculos lidos pela RLS. */

const cookieSet = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ set: cookieSet, get: () => undefined, delete: vi.fn() }) }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
const getSessionState = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionState: () => getSessionState() }));
const listPortalLinks = vi.fn();
vi.mock("@/lib/auth/portal-context", () => ({ listPortalLinks: (...args: unknown[]) => listPortalLinks(...args) }));
vi.mock("@/lib/supabase/admin", () => {
  throw new Error("o portal não pode usar o cliente de chave secreta");
});

import { selectCompanyAction } from "@/app/portal/actions";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const OUTRA = "33333333-3333-4333-8333-333333333333";
const user = (role: string) => ({ kind: "ok", user: { id: "u1", role, organizationId: "o1" } });
const links = [
  { approverId: "a1", clientId: A, clientName: "Casa Aurora" },
  { approverId: "a2", clientId: B, clientName: "Vita Nutri" },
];
const SAVED = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_URL = "https://projeto-de-teste.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_" + "x".repeat(30);
  delete process.env.APROVA_DEMO_MODE;
  getSessionState.mockResolvedValue(user("cliente"));
  listPortalLinks.mockResolvedValue(links);
});
afterEach(() => {
  process.env = { ...SAVED };
});

describe("selectCompanyAction", () => {
  it("grava a preferência (httpOnly, SameSite, só em /portal) quando a empresa é um vínculo do usuário", async () => {
    expect(await selectCompanyAction(B)).toEqual({ ok: true });
    expect(cookieSet).toHaveBeenCalledTimes(1);
    const [name, value, options] = cookieSet.mock.calls[0];
    expect(name).toBe("aprova_portal_cliente");
    expect(value).toBe(B);
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/portal" });
    expect(options.maxAge).toBeGreaterThan(0);
    expect(revalidatePath).toHaveBeenCalledWith("/portal", "layout");
  });

  it("recusa empresa que NÃO é vínculo do usuário e não grava nada (o cookie não é confiável)", async () => {
    const result = await selectCompanyAction(OUTRA);
    expect(result.error).toMatch(/não tem acesso a esta empresa/);
    expect(cookieSet).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("recusa valores que não são UUID", async () => {
    for (const lixo of ["", "' or 1=1 --", "casa aurora", "../../etc"]) {
      expect((await selectCompanyAction(lixo)).error, lixo).toMatch(/inválida/);
    }
    expect((await selectCompanyAction(undefined as unknown as string)).error).toMatch(/inválida/);
    expect(listPortalLinks).not.toHaveBeenCalled();
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it("só aprovador de cliente escolhe empresa; equipe e anônimo não", async () => {
    getSessionState.mockResolvedValue(user("admin"));
    expect((await selectCompanyAction(A)).error).toMatch(/permissão/);
    getSessionState.mockResolvedValue({ kind: "anonymous" });
    expect((await selectCompanyAction(A)).error).toMatch(/sessão expirou/);
    getSessionState.mockResolvedValue({ kind: "no-access" });
    expect((await selectCompanyAction(A)).error).toMatch(/sessão expirou/);
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it("falha de rede não vira 'sem acesso': avisa o serviço indisponível", async () => {
    getSessionState.mockResolvedValue({ kind: "unavailable" });
    expect((await selectCompanyAction(A)).error).toMatch(/serviço de autenticação/);
    getSessionState.mockResolvedValue(user("cliente"));
    listPortalLinks.mockRejectedValue(new Error("rede"));
    const result = await selectCompanyAction(A);
    expect(result.error).toMatch(/serviço de autenticação/);
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it("sem Supabase configurado falha fechado; na demonstração é inofensivo", async () => {
    delete process.env.SUPABASE_URL;
    expect((await selectCompanyAction(A)).error).toMatch(/não foi configurado/);
    process.env.APROVA_DEMO_MODE = "true";
    expect(await selectCompanyAction(A)).toEqual({ ok: true });
    expect(cookieSet).not.toHaveBeenCalled();
  });
});
