// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Step {
  table: string;
  method: string;
  args: unknown[];
}
let steps: Step[] = [];
let result: { data: unknown; error: { message: string } | null } = { data: [], error: null };

function builderFor(table: string) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      steps.push({ table, method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return builder;
}
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ from: builderFor }) }));

import { TEAM_ROLES, TEAM_USERS_LIMIT, TEAM_USERS_SELECT, listTeamUsers } from "./queries";

const ORG = "0b8f2a6e-5d8c-4a3e-9f57-2f1a3c4d5e6f";
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n: number, over: Record<string, unknown> = {}) => ({
  id: U(n),
  full_name: `Pessoa ${n}`,
  email: `pessoa${n}@luvi.test`,
  role: "designer",
  active: true,
  created_at: "2026-03-05T12:00:00Z",
  ...over,
});

beforeEach(() => {
  steps = [];
  result = { data: [], error: null };
});

describe("listTeamUsers", () => {
  it("lê só a equipe (sem papel cliente) da própria organização, sob a RLS, ordenada e com limite", async () => {
    await listTeamUsers(ORG);
    expect(steps.every((s) => s.table === "profiles")).toBe(true);
    expect(steps.find((s) => s.method === "select")?.args[0]).toBe(TEAM_USERS_SELECT);
    expect(steps.find((s) => s.method === "eq")?.args).toEqual(["organization_id", ORG]);
    expect(steps.find((s) => s.method === "in")?.args).toEqual(["role", ["admin", "designer", "atendimento"]]);
    expect(TEAM_ROLES).not.toContain("cliente");
    expect(steps.find((s) => s.method === "limit")?.args[0]).toBe(TEAM_USERS_LIMIT);
  });

  it("não pede 'último acesso' nem colunas de segredo: só nome, e-mail, papel, situação e cadastro", () => {
    expect(TEAM_USERS_SELECT).toBe("id, full_name, email, role, active, created_at");
  });

  it("devolve nome, e-mail, papel, situação e a data real de cadastro, administrador primeiro", async () => {
    result = {
      data: [
        row(1, { full_name: "Zélia", role: "atendimento", active: false, created_at: "2026-04-20T12:00:00Z" }),
        row(2, { full_name: "Bruno", role: "designer" }),
        row(3, { full_name: "Ana", role: "admin", created_at: "2026-02-10T12:00:00Z" }),
        row(4, { full_name: "Álvaro", role: "designer" }),
      ],
      error: null,
    };
    const users = await listTeamUsers(ORG);
    expect(users.map((u) => u.name)).toEqual(["Ana", "Álvaro", "Bruno", "Zélia"]);
    expect(users[0]).toEqual({ id: U(3), name: "Ana", email: "pessoa3@luvi.test", role: "admin", active: true, createdAt: "2026-02-10T12:00:00Z" });
    expect(users[3]).toMatchObject({ role: "atendimento", active: false, createdAt: "2026-04-20T12:00:00Z" });
  });

  it("lista vazia é válida (a tela mostra o estado vazio)", async () => {
    expect(await listTeamUsers(ORG)).toEqual([]);
  });

  it("falha fechada: se a resposta trouxer um aprovador (cliente), nada é exibido", async () => {
    result = { data: [row(1, { role: "cliente" })], error: null };
    await expect(listTeamUsers(ORG)).rejects.toThrow(/Não foi possível carregar os usuários/);
  });

  it("erro do banco e resposta fora do formato viram DataLoadError", async () => {
    result = { data: null, error: { message: "permission denied for table profiles" } };
    await expect(listTeamUsers(ORG)).rejects.toMatchObject({ name: "DataLoadError" });
    result = { data: [{ id: "x" }], error: null };
    await expect(listTeamUsers(ORG)).rejects.toMatchObject({ name: "DataLoadError" });
  });

  it("organização inválida não consulta o banco", async () => {
    expect(await listTeamUsers("não-é-uuid")).toEqual([]);
    expect(steps).toEqual([]);
  });
});
