// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildPlan, diagnoseSupabaseFailure, redactSecrets, runBootstrap } from "../../scripts/bootstrap-admin.mjs";
import { PRODUCTION_SUPABASE_HOST } from "@/lib/env";

/**
 * Diagnóstico das falhas do Supabase no bootstrap-admin: distingue rede, chave, permissão, tabela inexistente e
 * serviço indisponível, mostra HTTP e código, e NUNCA revela credenciais (nem se o servidor as repetir na mensagem).
 * Origem: em produção o service_role não tinha SELECT em profiles e o script só dizia "...: " (HEAD sem corpo).
 */

const SECRET = "sb_secret_" + "k".repeat(30);
const JWT = "eyJhbGciOiJIUzI1NiJ9." + Buffer.from('{"role":"service_role"}').toString("base64url") + ".assinatura-de-teste";
const HOST = PRODUCTION_SUPABASE_HOST;
const diag = (failure: Record<string, unknown>, stage = "Etapa X") => diagnoseSupabaseFailure(failure, { stage, host: HOST, secrets: [SECRET] });

describe("diagnoseSupabaseFailure", () => {
  it("permissão: 403 / 42501 aponta a migration 16 e o SQL de verificação (caso real da produção)", () => {
    for (const f of [{ status: 403, code: "42501", message: "permission denied for table profiles" }, { status: 403, message: "" }, { code: "42501" }]) {
      const d = diag(f);
      expect(d.kind).toBe("permissao");
      expect(d.text).toMatch(/service_role/);
      expect(d.text).toMatch(/20261120120000_service_role_grants/);
      expect(d.text).toMatch(/verify-service-role\.sql/);
    }
    const real = diag({ status: 403, code: "42501", message: "permission denied for table profiles" }, "Não foi possível consultar a tabela profiles");
    expect(real.text).toMatch(/HTTP 403/);
    expect(real.text).toMatch(/código 42501/);
    expect(real.text).toMatch(/permission denied for table profiles/);
  });

  it("chave inválida ou de outro projeto: 401, JWT/apikey e códigos do Auth", () => {
    for (const f of [
      { status: 401, message: "Invalid API key" },
      { status: 401, code: "PGRST301", message: "JWSError JWSInvalidSignature" },
      { status: 403, code: "not_admin", message: "User not allowed" },
      { status: 401, code: "bad_jwt", message: "invalid JWT" },
    ]) {
      const d = diag(f);
      expect(d.kind, JSON.stringify(f)).toBe("autenticacao");
      expect(d.text).toContain(HOST);
      expect(d.text).toMatch(/OUTRO projeto/);
    }
  });

  it("rede: fetch falhou, DNS, tempo esgotado, status 0 e o erro de rede do Auth", () => {
    for (const f of [
      { status: 0, message: "TypeError: fetch failed" },
      { message: "getaddrinfo ENOTFOUND exemplo.supabase.co" },
      { message: "connect ETIMEDOUT 1.2.3.4:443" },
      { status: 0, name: "AuthRetryableFetchError", message: "" },
    ]) {
      expect(diag(f).kind, JSON.stringify(f)).toBe("rede");
    }
  });

  it("tabela inexistente, schema não exposto e serviço indisponível", () => {
    expect(diag({ status: 404, code: "PGRST205", message: "Could not find the table 'public.profiles' in the schema cache" }).kind).toBe("tabela");
    expect(diag({ code: "42P01", message: 'relation "public.profiles" does not exist' }).kind).toBe("tabela");
    expect(diag({ status: 406, code: "PGRST106", message: "Invalid schema: public" }).kind).toBe("schema");
    expect(diag({ status: 503, message: "upstream connect error" }).kind).toBe("servico");
    expect(diag({ status: 522, message: "" }).kind).toBe("servico");
  });

  it("desconhecido continua útil: mostra status e código, ou avisa que não veio corpo", () => {
    expect(diag({ status: 418, code: "XX999", message: "algo novo" }).text).toMatch(/HTTP 418; código XX999; mensagem: algo novo/);
    expect(diag({}).text).toMatch(/sem status nem corpo de resposta/);
  });

  it("NUNCA revela credenciais, mesmo que o servidor as repita na mensagem ou no código", () => {
    const d = diag({ status: 401, code: SECRET, message: `Invalid API key ${SECRET} / Bearer ${JWT} / sb_publishable_${"p".repeat(30)}` });
    expect(d.text).not.toContain(SECRET);
    expect(d.text).not.toContain(JWT);
    expect(d.text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(d.text).not.toMatch(/sb_(secret|publishable)_[A-Za-z0-9]/);
    expect(d.text).toContain("[removido]");
  });

  it("redactSecrets remove a chave informada, sb_* e JWT, e aceita lista vazia", () => {
    expect(redactSecrets(`a ${SECRET} b ${JWT} c`, [SECRET])).toBe("a [removido] b [removido] c");
    expect(redactSecrets(undefined)).toBe("");
    expect(redactSecrets("texto comum", ["curta"])).toBe("texto comum");
  });
});

type Fail = {
  count?: { error: Record<string, unknown>; status: number };
  listUsers?: { message: string; status?: number; code?: string; name?: string };
  orgInsert?: { error: Record<string, unknown>; status: number };
  profileInsert?: { error: Record<string, unknown>; status: number };
};

/** Cliente administrativo falso que falha onde se pede. Sem rede. */
function failingAdmin(fail: Fail) {
  const calls: string[] = [];
  const admin = {
    from(table: string) {
      return {
        select(_cols: string, opts?: { count?: string }) {
          if (opts?.count) {
            return {
              limit: async () =>
                fail.count ? { data: null, count: null, error: fail.count.error, status: fail.count.status } : { data: [], count: 0, error: null, status: 200 },
            };
          }
          const chain = { eq: () => chain, maybeSingle: async () => ({ data: null, error: null, status: 200 }) };
          return chain;
        },
        insert() {
          calls.push(`insert:${table}`);
          if (table === "profiles") return Promise.resolve(fail.profileInsert ? { error: fail.profileInsert.error, status: fail.profileInsert.status } : { error: null });
          return {
            select: () => ({
              single: async () => (fail.orgInsert ? { data: null, error: fail.orgInsert.error, status: fail.orgInsert.status } : { data: { id: "org-1" }, error: null }),
            }),
          };
        },
      };
    },
    auth: {
      admin: {
        listUsers: async () => (fail.listUsers ? { data: null, error: fail.listUsers } : { data: { users: [] }, error: null }),
        generateLink: async () => ({ data: { user: { id: "user-1" }, properties: { hashed_token: "HASH" } }, error: null }),
        deleteUser: async () => {
          calls.push("deleteUser");
          return { error: null };
        },
      },
    },
  };
  return { admin, calls };
}

const prodEnv = { SUPABASE_URL: `https://${HOST}`, SUPABASE_SECRET_KEY: SECRET, APP_URL: "https://aprova.luvicompany.com.br" };
const argsFor = (extra: string[] = []) => ["--email", "admin@luvicompany.com.br", "--name", "Admin Teste", "--allow-production", ...extra];
const planFor = (extra: string[] = []) => {
  const plan = buildPlan(argsFor(extra), prodEnv);
  expect(plan.errors).toEqual([]);
  return plan;
};
const run = (fail: Fail, extra: string[] = []) => {
  const { admin, calls } = failingAdmin(fail);
  return { promise: runBootstrap(planFor(extra), admin, () => {}), calls };
};

describe("runBootstrap: a mensagem de erro mostra a causa e não vaza a chave", () => {
  it("sem permissão em profiles (o caso de produção): HTTP 403, código 42501 e a migration a aplicar", async () => {
    const { promise } = run({ count: { status: 403, error: { message: "permission denied for table profiles", code: "42501" } } }, ["--check-connection"]);
    const error = await promise.catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    const text = (error as Error).message;
    expect(text).toMatch(/Não foi possível consultar a tabela profiles/);
    expect(text).toMatch(/HTTP 403/);
    expect(text).toMatch(/42501/);
    expect(text).toMatch(/20261120120000_service_role_grants/);
    expect(text).not.toContain(SECRET);
  });

  it("erro sem corpo (o que o HEAD produzia): ainda mostra o status e o palpite de permissão", async () => {
    await expect(run({ count: { status: 403, error: { message: "" } } }, ["--check-connection"]).promise).rejects.toThrow(/HTTP 403/);
    await expect(run({ count: { status: 403, error: { message: "" } } }, ["--check-connection"]).promise).rejects.toThrow(/service_role/);
  });

  it("chave inválida, rede, tabela inexistente e serviço indisponível são distinguidos", async () => {
    const cases: Array<[Fail, RegExp]> = [
      [{ count: { status: 401, error: { message: "Invalid API key" } } }, /OUTRO projeto/],
      [{ count: { status: 0, error: { message: "TypeError: fetch failed" } } }, /rede, DNS ou URL/],
      [{ count: { status: 404, error: { message: "Could not find the table 'public.profiles' in the schema cache", code: "PGRST205" } } }, /NESTE projeto/],
      [{ count: { status: 503, error: { message: "" } } }, /pausado\/indisponível/],
    ];
    for (const [fail, pattern] of cases) await expect(run(fail, ["--check-connection"]).promise).rejects.toThrow(pattern);
  });

  it("falha na API administrativa do Auth também é classificada", async () => {
    await expect(run({ listUsers: { message: "invalid JWT", status: 401, code: "bad_jwt" } }, ["--check-connection"]).promise).rejects.toThrow(/API administrativa do Auth.*OUTRO projeto/);
    await expect(run({ listUsers: { message: "fetch failed", status: 0, name: "AuthRetryableFetchError" } }, ["--check-connection"]).promise).rejects.toThrow(/rede, DNS ou URL/);
  });

  it("nenhuma mensagem de erro contém a chave, mesmo quando o servidor a repete", async () => {
    const echoes = { status: 401, error: { message: `Invalid API key ${SECRET}`, code: "PGRST301" } };
    const error = await run({ count: echoes }, ["--check-connection"]).promise.catch((e: Error) => e);
    expect((error as Error).message).not.toContain(SECRET);
    const listError = await run({ listUsers: { message: `bad ${JWT} ${SECRET}`, status: 401 } }, ["--check-connection"]).promise.catch((e: Error) => e);
    expect((listError as Error).message).not.toContain(SECRET);
    expect((listError as Error).message).not.toContain(JWT);
  });

  it("falha de permissão ao criar a organização ou o perfil é explicada; o perfil desfaz a conta criada", async () => {
    await expect(run({ orgInsert: { status: 403, error: { message: "permission denied for table organizations", code: "42501" } } }, ["--execute", "--project-host", HOST]).promise).rejects.toThrow(
      /Falha ao criar a organização.*HTTP 403.*42501/,
    );
    const r = run({ profileInsert: { status: 403, error: { message: "permission denied for table profiles", code: "42501" } } }, ["--execute", "--project-host", HOST]);
    await expect(r.promise).rejects.toThrow(/Falha ao criar o perfil.*HTTP 403.*42501/);
    expect(r.calls).toContain("deleteUser");
  });

  it("sem falha, a conexão passa e nada é criado (o GET de zero linhas não altera nada)", async () => {
    const r = run({}, ["--check-connection"]);
    await expect(r.promise).resolves.toEqual({ status: "checked" });
    expect(r.calls).toEqual([]);
  });
});
