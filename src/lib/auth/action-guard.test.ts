// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionState = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionState: () => getSessionState() }));
const userClient = { __cliente: "do-usuario" };
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => userClient }));

import { authorizeAdmin, authorizeStaff } from "@/lib/auth/action-guard";

const ok = (role: string) => ({
  kind: "ok",
  user: { id: "7c9e6679-7425-40de-944b-e07fc1f90ae7", email: "p@luvicompany.com.br", name: "Pessoa", initials: "PE", role, organizationId: "0b8f2a6e-5d8c-4a3e-9f57-2f1a3c4d5e6f" },
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_URL = "https://projeto-de-teste.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_" + "x".repeat(30);
  delete process.env.APROVA_DEMO_MODE;
});

describe("authorizeAdmin", () => {
  it("só o administrador ativo passa, e recebe o cliente DO USUÁRIO (nunca o de chave secreta)", async () => {
    getSessionState.mockResolvedValue(ok("admin"));
    const guard = await authorizeAdmin();
    expect(guard).toMatchObject({ ok: true, user: { role: "admin" }, supabase: userClient });
  });

  it("designer, atendimento e cliente são recusados com a mesma mensagem de negação", async () => {
    const messages = new Set<string>();
    for (const role of ["designer", "atendimento", "cliente"]) {
      getSessionState.mockResolvedValue(ok(role));
      const guard = await authorizeAdmin();
      expect(guard.ok, role).toBe(false);
      if (!guard.ok) messages.add(guard.error);
    }
    expect(messages.size).toBe(1);
  });

  it("anônimo, sem acesso (perfil inativo) e serviço de login indisponível são recusados", async () => {
    for (const kind of ["anonymous", "no-access", "unavailable"]) {
      getSessionState.mockResolvedValue({ kind });
      expect((await authorizeAdmin()).ok, kind).toBe(false);
    }
  });

  it("não configurado e demonstração são recusados antes de consultar a sessão", async () => {
    getSessionState.mockResolvedValue(ok("admin"));
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    expect((await authorizeAdmin()).ok).toBe(false);
    process.env.APROVA_DEMO_MODE = "true";
    const demo = await authorizeAdmin();
    expect(demo).toEqual({ ok: false, error: "Esta ação não está disponível na demonstração." });
    expect(getSessionState).not.toHaveBeenCalled();
  });

  it("é mais estrito que authorizeStaff: o designer passa em um e não no outro", async () => {
    getSessionState.mockResolvedValue(ok("designer"));
    expect((await authorizeStaff()).ok).toBe(true);
    expect((await authorizeAdmin()).ok).toBe(false);
  });
});
