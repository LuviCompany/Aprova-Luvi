// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildPlan, runBootstrap } from "../../scripts/bootstrap-admin.mjs";

/**
 * Núcleo do bootstrap-admin com um cliente Supabase FALSO (sem rede): criação do primeiro administrador e
 * reexecução segura depois de falha parcial. A senha nunca passa pelo script: o convite leva ao /redefinir-senha.
 */

const SECRET = "sb_secret_" + "s".repeat(30);
const env = { SUPABASE_URL: "https://projeto-dev.supabase.co", SUPABASE_SECRET_KEY: SECRET, APP_URL: "http://localhost:3000" };
const EMAIL = "admin@luvicompany.com.br";
const args = ["--email", EMAIL, "--name", "Admin Teste", "--execute", "--project-host", "projeto-dev.supabase.co"];

interface User { id: string; email: string; email_confirmed_at: string | null; last_sign_in_at: string | null }
interface State {
  profiles: Array<{ id: string; organization_id: string; full_name: string; email: string; role: string }>;
  orgs: Array<{ id: string; name: string; slug: string }>;
  users: User[];
  calls: string[];
  generateOptions: unknown[];
  failProfileInsert?: string;
  failGenerate?: { invite?: boolean; recovery?: boolean };
  failInvite?: boolean;
  failDelete?: boolean;
}

const newState = (over: Partial<State> = {}): State => ({ profiles: [], orgs: [], users: [], calls: [], generateOptions: [], ...over });

function fakeAdmin(s: State) {
  const ensureUser = (email: string): { user?: User; error?: { message: string } } => {
    let user = s.users.find((u) => u.email === email);
    if (user?.email_confirmed_at) return { error: { message: "A user with this email address has already been registered" } };
    if (!user) {
      user = { id: `user-${s.users.length + 1}`, email, email_confirmed_at: null, last_sign_in_at: null };
      s.users.push(user);
    }
    return { user };
  };
  return {
    from(table: "profiles" | "organizations") {
      return {
        select(_cols: string, opts?: { head?: boolean; count?: string }) {
          const rows = (table === "profiles" ? s.profiles : s.orgs) as Array<Record<string, unknown>>;
          if (opts?.count) return { limit: async () => ({ count: rows.length, data: [], error: null, status: 200 }) };
          let filtered = rows;
          const chain = {
            eq(key: string, value: unknown) {
              filtered = filtered.filter((r) => r[key] === value);
              return chain;
            },
            maybeSingle: async () => ({ data: filtered[0] ?? null, error: null }),
          };
          return chain;
        },
        insert(row: Record<string, unknown>) {
          s.calls.push(`insert:${table}`);
          if (table === "profiles") {
            if (s.failProfileInsert) return Promise.resolve({ error: { message: s.failProfileInsert } });
            s.profiles.push(row as State["profiles"][number]);
            return Promise.resolve({ error: null });
          }
          const created = { id: `org-${s.orgs.length + 1}`, ...(row as { name: string; slug: string }) };
          s.orgs.push(created);
          return { select: () => ({ single: async () => ({ data: created, error: null }) }) };
        },
      };
    },
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: s.users }, error: null }),
        getUserById: async (id: string) => {
          const user = s.users.find((u) => u.id === id);
          return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "not found" } };
        },
        generateLink: async (p: { type: "invite" | "recovery"; email: string; options?: unknown }) => {
          s.calls.push(`generateLink:${p.type}`);
          s.generateOptions.push(p.options);
          if (s.failGenerate?.[p.type]) return { data: null, error: { message: `falha ${p.type}` } };
          const r = ensureUser(p.email);
          if (r.error) return { data: null, error: r.error };
          return { data: { user: r.user, properties: { hashed_token: `HASH-${p.type}` } }, error: null };
        },
        inviteUserByEmail: async (email: string) => {
          s.calls.push("inviteUserByEmail");
          if (s.failInvite) return { data: null, error: { message: "smtp falhou" } };
          const r = ensureUser(email);
          return r.error ? { data: null, error: r.error } : { data: { user: r.user }, error: null };
        },
        deleteUser: async (id: string) => {
          s.calls.push("deleteUser");
          if (s.failDelete) return { error: { message: "rede" } };
          s.users = s.users.filter((u) => u.id !== id);
          return { error: null };
        },
      },
    },
  };
}

const plan = (extra: string[] = []) => {
  const p = buildPlan([...args, ...extra], env);
  expect(p.errors).toEqual([]);
  return p;
};
async function run(s: State, extra: string[] = []) {
  const logs: string[] = [];
  const result = await runBootstrap(plan(extra), fakeAdmin(s), (line: string) => logs.push(line));
  return { result, logs: logs.join("\n") };
}

describe("bootstrap-admin: criação do primeiro administrador", () => {
  it("cria organização, usuário do Auth e perfil admin vinculado; imprime só o link (sem senha)", async () => {
    const s = newState();
    const { result, logs } = await run(s);
    expect(result.status).toBe("created");
    expect(s.orgs).toEqual([{ id: "org-1", name: "Luvi Company", slug: "luvi-company" }]);
    expect(s.users).toHaveLength(1);
    expect(s.profiles).toEqual([
      { id: "user-1", organization_id: "org-1", full_name: "Admin Teste", email: EMAIL, role: "admin" },
    ]);
    expect(logs).toContain("http://localhost:3000/auth/invite?token_hash=HASH-invite&type=invite");
    // nenhuma senha é criada ou enviada: o convite só leva ao /redefinir-senha
    expect(JSON.stringify(s.generateOptions)).not.toMatch(/password/i);
    expect(logs).not.toContain(SECRET);
  });

  it("--check-connection só lê: nada é criado", async () => {
    const s = newState();
    const logs: string[] = [];
    const p = buildPlan([...args.filter((a) => a !== "--execute" && a !== "--project-host" && a !== "projeto-dev.supabase.co"), "--check-connection"], env);
    const result = await runBootstrap(p, fakeAdmin(s), (l: string) => logs.push(l));
    expect(result.status).toBe("checked");
    expect(s).toMatchObject({ profiles: [], orgs: [], users: [], calls: [] });
  });

  it("com --send-email convida pelo Supabase e NÃO imprime link", async () => {
    const s = newState();
    const { result, logs } = await run(s, ["--send-email"]);
    expect(result.status).toBe("created");
    expect(s.calls).toContain("inviteUserByEmail");
    expect(logs).not.toMatch(/token_hash/);
    expect(s.profiles).toHaveLength(1);
  });
});

describe("bootstrap-admin: reexecução segura após falha parcial", () => {
  it("falha ao criar o perfil: a conta recém-criada é desfeita e a nova tentativa funciona (organização reaproveitada)", async () => {
    const s = newState({ failProfileInsert: "violação de regra" });
    await expect(run(s)).rejects.toThrow(/Falha ao criar o perfil/);
    expect(s.users).toEqual([]); // sem conta órfã
    expect(s.profiles).toEqual([]);
    expect(s.orgs).toHaveLength(1);

    s.failProfileInsert = undefined;
    const { result } = await run(s);
    expect(result.status).toBe("created");
    expect(s.orgs).toHaveLength(1); // não duplicou a organização
    expect(s.users).toHaveLength(1);
    expect(s.profiles).toHaveLength(1);
  });

  it("se até o desfazer falhar (conta órfã sem perfil), a nova tentativa reaproveita a conta", async () => {
    const s = newState({ failProfileInsert: "x", failDelete: true });
    await expect(run(s)).rejects.toThrow(/Falha ao criar o perfil/);
    expect(s.users).toHaveLength(1); // órfã
    s.failProfileInsert = undefined;
    s.failDelete = false;
    const { result } = await run(s);
    expect(result.status).toBe("created");
    expect(s.users).toHaveLength(1); // a mesma conta, sem duplicar
    expect(s.profiles).toEqual([expect.objectContaining({ id: s.users[0].id, role: "admin" })]);
  });

  it("e-mail do convite falhou (com --send-email): nada de perfil; repetir depois funciona", async () => {
    const s = newState({ failInvite: true });
    await expect(run(s, ["--send-email"])).rejects.toThrow(/Falha ao convidar/);
    expect(s.profiles).toEqual([]);
    s.failInvite = false;
    expect((await run(s, ["--send-email"])).result.status).toBe("created");
    expect(s.profiles).toHaveLength(1);
  });

  it("perfil criado mas convite não entregue (terminal fechado): reexecutar RETOMA e emite novo convite, sem duplicar nada", async () => {
    const s = newState();
    await run(s);
    const before = JSON.stringify({ profiles: s.profiles, orgs: s.orgs });
    const { result, logs } = await run(s);
    expect(result.status).toBe("resumed");
    expect(logs).toContain("retomado (novo convite)");
    expect(logs).toContain("token_hash=HASH-invite");
    expect(JSON.stringify({ profiles: s.profiles, orgs: s.orgs })).toBe(before);
    expect(s.users).toHaveLength(1);
  });

  it("retomada: se o convite não puder ser refeito, usa o link de recuperação (mesmo destino)", async () => {
    const s = newState();
    await run(s);
    s.failGenerate = { invite: true };
    const { result, logs } = await run(s);
    expect(result.status).toBe("resumed");
    expect(logs).toContain("/auth/recovery?token_hash=HASH-recovery&type=recovery");
  });

  it("retomada com --send-email reenvia o convite pelo Supabase", async () => {
    const s = newState();
    await run(s, ["--send-email"]);
    const { result, logs } = await run(s, ["--send-email"]);
    expect(result.status).toBe("resumed");
    expect(logs).not.toMatch(/token_hash/);
    expect(s.calls.filter((c) => c === "inviteUserByEmail")).toHaveLength(2);
  });

  it("administrador que JÁ ativou a conta: recusa (use 'Esqueci minha senha')", async () => {
    const s = newState();
    await run(s);
    s.users[0].email_confirmed_at = "2026-11-20T10:00:00Z";
    await expect(run(s)).rejects.toThrow(/já ativou a conta/);
    s.users[0].email_confirmed_at = null;
    s.users[0].last_sign_in_at = "2026-11-20T10:00:00Z";
    await expect(run(s)).rejects.toThrow(/já ativou a conta/);
  });

  it("recusa em banco que já tem outros perfis (só o MESMO administrador pode ser retomado)", async () => {
    const outroPerfil = { id: "u-x", organization_id: "org-1", full_name: "Outra Pessoa", email: "outra@luvicompany.com.br", role: "admin" };
    const s1 = newState({ profiles: [outroPerfil], orgs: [{ id: "org-1", name: "Luvi Company", slug: "luvi-company" }] });
    await expect(run(s1)).rejects.toThrow(/só roda em um banco vazio/);

    const s2 = newState();
    await run(s2);
    s2.profiles.push({ ...outroPerfil });
    await expect(run(s2)).rejects.toThrow(/só roda em um banco vazio/); // dois perfis

    const s3 = newState();
    await run(s3);
    s3.profiles[0].role = "cliente";
    await expect(run(s3)).rejects.toThrow(/só roda em um banco vazio/); // o perfil não é admin
  });

  it("perfil sem a conta correspondente no Auth: recusa e manda investigar", async () => {
    const s = newState();
    await run(s);
    s.users = [];
    await expect(run(s)).rejects.toThrow(/conta correspondente não foi encontrada/);
  });
});
