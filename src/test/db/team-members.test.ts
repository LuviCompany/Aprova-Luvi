// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDS, createTestDb, seedBase, uid, type TestDb } from "./harness";

/**
 * Migration 17: membros da equipe convidados pelo painel. As regras valem NO BANCO: mesmo chamando a função SQL direto
 * (sem passar pela Server Action), só um administrador ativo cria perfis, sempre na própria organização.
 */

const M17 = "20261121120000";
const dir = join(process.cwd(), "supabase");
const migration = readFileSync(join(dir, "migrations", `${M17}_team_members.sql`), "utf8");
const verifySql = readFileSync(join(dir, "verify-team-members.sql"), "utf8");

type Check = { bloco: number; tipo: string; verificacao: string; valor: string };
const runVerify = async (db: TestDb): Promise<Check[]> => (await db.query<Check>(verifySql)).rows;
const violations = (rows: Check[]) => Object.fromEntries(rows.filter((r) => r.tipo === "violacao").map((r) => [r.bloco, Number(r.valor)]));
const prints = (rows: Check[]) => Object.fromEntries(rows.filter((r) => r.tipo === "impressao").map((r) => [r.bloco, r.valor]));

describe("verificação antes e depois da migration 17", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb({ stopBefore: M17 });
    await seedBase(db);
  });
  afterAll(async () => db.close());

  it("antes: faltam as 3 funções e mais nada acusa; depois: tudo em 0 e as impressões não mudam", async () => {
    const before = await runVerify(db);
    expect(violations(before)).toEqual({ 1: 3, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 });
    await db.exec(migration);
    const after = await runVerify(db);
    expect(violations(after)).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 });
    expect(prints(after)).toEqual(prints(before));
  });
});

describe("add_team_member e reserve_team_invite_resend", () => {
  let db: TestDb;
  let n = 5000;
  const newAuthUser = async (email: string, over: { confirmed?: boolean; signedIn?: boolean } = {}) => {
    const id = uid(++n);
    await db.query("insert into auth.users (id, email, email_confirmed_at, last_sign_in_at) values ($1, $2, $3, $4)", [
      id,
      email,
      over.confirmed ? new Date().toISOString() : null,
      over.signedIn ? new Date().toISOString() : null,
    ]);
    return id;
  };
  const add = (actor: string, userId: string, name: string, email: string, role: string) =>
    db.asUser(actor, () => db.query<{ add_team_member: string }>("select public.add_team_member($1, $2, $3, $4)", [userId, name, email, role]));
  const profile = async (id: string) =>
    (await db.query<{ organization_id: string; full_name: string; email: string; role: string; active: boolean }>("select organization_id, full_name, email, role, active from public.profiles where id = $1", [id])).rows[0];
  const events = async (entityId: string) =>
    (await db.query<{ action: string; actor_profile_id: string | null; organization_id: string; entity_type: string; metadata: Record<string, unknown> }>(
      "select action, actor_profile_id, organization_id, entity_type, metadata from public.audit_events where entity_id = $1 order by id",
      [entityId],
    )).rows;
  const code = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return (error as { code?: string }).code ?? "sem-código";
    }
    return "ok";
  };

  beforeAll(async () => {
    db = await createTestDb();
    await seedBase(db);
  });
  afterAll(async () => db.close());

  describe("quem pode convidar (também chamando a função SQL diretamente)", () => {
    it("administrador ativo cria Administrador, Designer e Atendimento na SUA organização", async () => {
      for (const role of ["admin", "designer", "atendimento"]) {
        const id = await newAuthUser(`novo-${role}@luvi.test`);
        const result = await add(IDS.admin, id, `  Novo ${role}  `, `Novo-${role}@Luvi.Test`, role);
        expect(result.rows[0].add_team_member).toBe(id);
        expect(await profile(id)).toEqual({ organization_id: IDS.orgLuvi, full_name: `Novo ${role}`, email: `novo-${role}@luvi.test`, role, active: true });
      }
    });

    it("nunca cria outra organização e usa a organização do ADMINISTRADOR, não a de outra agência", async () => {
      const before = (await db.query<{ n: string }>("select count(*)::text as n from public.organizations")).rows[0].n;
      const id = await newAuthUser("da-outra-agencia@luvi.test");
      await add(IDS.staffOutraOrg, id, "Pessoa da Outra Agência", "da-outra-agencia@luvi.test", "designer");
      expect((await profile(id)).organization_id).toBe(IDS.orgOutra);
      expect((await db.query<{ n: string }>("select count(*)::text as n from public.organizations")).rows[0].n).toBe(before);
    });

    it("designer, atendimento e cliente são recusados (42501) e nada é criado", async () => {
      for (const actor of [IDS.designer, IDS.atendimento, IDS.userClienteA]) {
        const id = await newAuthUser(`negado-${actor.slice(-3)}@luvi.test`);
        expect(await code(add(actor, id, "Pessoa Negada", `negado-${actor.slice(-3)}@luvi.test`, "designer")), actor).toBe("42501");
        expect(await profile(id)).toBeUndefined();
      }
    });

    it("administrador INATIVO é recusado", async () => {
      const inactiveAdmin = await newAuthUser("admin-inativo@luvi.test");
      await db.query("insert into public.profiles (id, organization_id, full_name, email, role, active) values ($1,$2,'Admin Inativo','admin-inativo@luvi.test','admin',false)", [inactiveAdmin, IDS.orgLuvi]);
      const id = await newAuthUser("alvo-do-inativo@luvi.test");
      expect(await code(add(inactiveAdmin, id, "Alvo do Inativo", "alvo-do-inativo@luvi.test", "designer"))).toBe("42501");
      expect(await profile(id)).toBeUndefined();
    });

    it("sem sessão (anônimo) e service_role não executam a função", async () => {
      const id = await newAuthUser("sem-sessao@luvi.test");
      expect(await code(db.asAnon(() => db.query("select public.add_team_member($1,$2,$3,$4)", [id, "Sem Sessão", "sem-sessao@luvi.test", "designer"])))).toBe("42501");
      expect(await code(db.asService(() => db.query("select public.add_team_member($1,$2,$3,$4)", [id, "Sem Sessão", "sem-sessao@luvi.test", "designer"])))).toBe("42501");
      expect(await code(db.query("select public.add_team_member($1,$2,$3,$4)", [id, "Sem Sessão", "sem-sessao@luvi.test", "designer"]))).toBe("42501"); // sem auth.uid()
      expect(await profile(id)).toBeUndefined();
    });

    it("um administrador criado por convite também pode convidar (e um designer criado, não)", async () => {
      const adminId = await newAuthUser("segundo-admin@luvi.test");
      await add(IDS.admin, adminId, "Segundo Admin", "segundo-admin@luvi.test", "admin");
      const designerId = await newAuthUser("novo-designer-2@luvi.test");
      await add(IDS.admin, designerId, "Novo Designer", "novo-designer-2@luvi.test", "designer");
      const a = await newAuthUser("convidado-pelo-segundo@luvi.test");
      expect(await code(add(adminId, a, "Convidado Pelo Segundo", "convidado-pelo-segundo@luvi.test", "atendimento"))).toBe("ok");
      const b = await newAuthUser("convidado-pelo-designer@luvi.test");
      expect(await code(add(designerId, b, "Convidado Pelo Designer", "convidado-pelo-designer@luvi.test", "atendimento"))).toBe("42501");
    });
  });

  describe("validações no banco", () => {
    it("papel cliente, papel nulo e papel inexistente são recusados", async () => {
      const id = await newAuthUser("papel-ruim@luvi.test");
      expect(await code(add(IDS.admin, id, "Papel Ruim", "papel-ruim@luvi.test", "cliente"))).toBe("22023");
      expect(await code(db.asUser(IDS.admin, () => db.query("select public.add_team_member($1,$2,$3,null)", [id, "Papel Ruim", "papel-ruim@luvi.test"])))).toBe("22023");
      expect(await code(add(IDS.admin, id, "Papel Ruim", "papel-ruim@luvi.test", "superadmin"))).not.toBe("ok");
      expect(await profile(id)).toBeUndefined();
    });

    it("nome e e-mail inválidos são recusados", async () => {
      const id = await newAuthUser("dados-ruins@luvi.test");
      expect(await code(add(IDS.admin, id, "A", "dados-ruins@luvi.test", "designer"))).toBe("22023");
      expect(await code(add(IDS.admin, id, "x".repeat(121), "dados-ruins@luvi.test", "designer"))).toBe("22023");
      expect(await code(add(IDS.admin, id, "Dados Ruins", "isto-nao-e-email", "designer"))).toBe("22023");
      expect(await profile(id)).toBeUndefined();
    });

    it("o id e o e-mail precisam ser do MESMO usuário do Auth", async () => {
      const real = await newAuthUser("conta-real@luvi.test");
      expect(await code(add(IDS.admin, real, "Outro Nome", "outro-email@luvi.test", "designer"))).toBe("22023"); // e-mail de outra pessoa
      expect(await code(add(IDS.admin, uid(999999), "Id Inventado", "conta-real@luvi.test", "designer"))).toBe("22023"); // id inexistente
      expect(await profile(real)).toBeUndefined();
    });

    it("conta do Auth já ATIVADA (e-mail confirmado ou já fez login) não recebe papel", async () => {
      const confirmed = await newAuthUser("ja-confirmada@luvi.test", { confirmed: true });
      const signedIn = await newAuthUser("ja-entrou@luvi.test", { signedIn: true });
      expect(await code(add(IDS.admin, confirmed, "Já Confirmada", "ja-confirmada@luvi.test", "admin"))).toBe("22023");
      expect(await code(add(IDS.admin, signedIn, "Já Entrou", "ja-entrou@luvi.test", "admin"))).toBe("22023");
    });

    it("duplicados: mesmo usuário duas vezes e e-mail que já tem perfil (mesmo com outra caixa) viram 23505", async () => {
      const id = await newAuthUser("duplicado@luvi.test");
      await add(IDS.admin, id, "Pessoa Única", "duplicado@luvi.test", "designer");
      expect(await code(add(IDS.admin, id, "Pessoa Única", "duplicado@luvi.test", "designer"))).toBe("23505");
      const outroId = await newAuthUser("ADMIN@LUVI.TEST"); // outra conta do Auth, e-mail igual ao do administrador em outra caixa
      expect(await code(add(IDS.admin, outroId, "Cópia do Admin", "admin@luvi.test", "admin"))).toBe("23505");
      expect(await profile(outroId)).toBeUndefined();
    });
  });

  describe("auditoria", () => {
    it("grava quem convidou, a organização, a entidade e SÓ o papel: sem nome, e-mail, token, senha ou link", async () => {
      const id = await newAuthUser("auditado@luvi.test");
      await add(IDS.admin, id, "Pessoa Auditada", "auditado@luvi.test", "atendimento");
      const [event, ...rest] = await events(id);
      expect(rest).toEqual([]);
      expect(event).toMatchObject({ action: "team_member.invited", actor_profile_id: IDS.admin, organization_id: IDS.orgLuvi, entity_type: "profile" });
      expect(event.metadata).toEqual({ role: "atendimento", actor_role: "admin" });
      const text = JSON.stringify(event);
      expect(text).not.toMatch(/Auditada|auditado@|token|senha|password|http/i);
    });

    it("convite recusado não deixa evento nem perfil", async () => {
      const id = await newAuthUser("recusado@luvi.test");
      await code(add(IDS.designer, id, "Pessoa Recusada", "recusado@luvi.test", "designer"));
      expect(await events(id)).toEqual([]);
    });

    it("a auditoria continua imutável e a função interna de escrita não é chamável pelo app", async () => {
      const id = await newAuthUser("imutavel@luvi.test");
      await add(IDS.admin, id, "Pessoa Imutável", "imutavel@luvi.test", "designer");
      expect(await code(db.query("update public.audit_events set action = 'x_y_z' where entity_id = $1", [id]))).not.toBe("ok");
      expect(await code(db.query("delete from public.audit_events where entity_id = $1", [id]))).not.toBe("ok");
      const internal = (run: <T>(fn: () => Promise<T>) => Promise<T>) =>
        code(run(() => db.query("select app.write_org_audit($1,$2,'a_b_c','profile',$3,'{}')", [IDS.orgLuvi, IDS.admin, id])));
      expect(await internal((fn) => db.asUser(IDS.admin, fn))).toBe("42501");
      expect(await internal((fn) => db.asService(fn))).toBe("42501");
      expect(await internal((fn) => db.asAnon(fn))).toBe("42501");
    });
  });

  describe("sem escalonamento de privilégios", () => {
    it("o app não insere perfis nem altera papel, organização, situação ou e-mail", async () => {
      const id = await newAuthUser("escalonamento@luvi.test");
      expect(await code(db.asUser(IDS.admin, () => db.query("insert into public.profiles (id, organization_id, full_name, email, role) values ($1,$2,'Esc Alonamento','escalonamento@luvi.test','admin')", [id, IDS.orgLuvi])))).toBe("42501");
      for (const column of ["role", "organization_id", "active", "email"]) {
        const value = column === "role" ? "'admin'" : column === "active" ? "false" : column === "email" ? "'x@y.test'" : `'${IDS.orgOutra}'`;
        for (const actor of [IDS.designer, IDS.admin]) {
          expect(await code(db.asUser(actor, () => db.query(`update public.profiles set ${column} = ${value} where id = $1`, [IDS.designer]))), `${actor} ${column}`).toBe("42501");
        }
      }
      expect((await profile(IDS.designer)).role).toBe("designer");
    });

    it("o service_role também não altera papel (a migration 16 só dá INSERT em colunas fixas e DELETE)", async () => {
      expect(await code(db.asService(() => db.query("update public.profiles set role = 'admin' where id = $1", [IDS.designer])))).toBe("42501");
    });

    it("executam as funções novas: authenticated sim; anon e service_role não; a interna, ninguém", async () => {
      const has = async (role: string, sig: string) => (await db.query<{ ok: boolean }>(`select has_function_privilege('${role}', '${sig}', 'EXECUTE') as ok`)).rows[0].ok;
      for (const sig of ["public.add_team_member(uuid,text,text,public.app_role)", "public.reserve_team_invite_resend(uuid)"]) {
        expect(await has("authenticated", sig), sig).toBe(true);
        expect(await has("anon", sig), sig).toBe(false);
        expect(await has("service_role", sig), sig).toBe(false);
      }
      for (const role of ["authenticated", "anon", "service_role"]) {
        expect(await has(role, "app.write_org_audit(uuid,uuid,text,text,uuid,jsonb)"), role).toBe(false);
      }
    });
  });

  describe("reserve_team_invite_resend: reenvio com intervalo de 1 minuto", () => {
    const reserve = (actor: string, userId: string) =>
      db.asUser(actor, () => db.query<{ r_full_name: string; r_email: string; r_role: string }>("select * from public.reserve_team_invite_resend($1)", [userId]));
    const backdate = async (userId: string) => {
      await db.exec("alter table public.audit_events disable trigger audit_events_immutable");
      await db.query("update public.audit_events set created_at = now() - interval '2 minutes' where entity_id = $1", [userId]);
      await db.exec("alter table public.audit_events enable trigger audit_events_immutable");
    };

    it("logo depois do convite espera 1 minuto; passado o minuto reserva, devolve nome/e-mail/papel e audita; e espera de novo", async () => {
      const id = await newAuthUser("reenvio@luvi.test");
      await add(IDS.admin, id, "Pessoa Reenvio", "reenvio@luvi.test", "designer");
      const early = await code(reserve(IDS.admin, id));
      expect(early).toBe("P0001");
      await backdate(id);
      const result = await reserve(IDS.admin, id);
      expect(result.rows[0]).toEqual({ r_full_name: "Pessoa Reenvio", r_email: "reenvio@luvi.test", r_role: "designer" });
      const log = await events(id);
      expect(log.map((e) => e.action)).toEqual(["team_member.invited", "team_member.invite_resent"]);
      expect(log[1]).toMatchObject({ actor_profile_id: IDS.admin, organization_id: IDS.orgLuvi });
      expect(log[1].metadata).toEqual({ role: "designer", actor_role: "admin" });
      expect(await code(reserve(IDS.admin, id))).toBe("P0001"); // o reenvio acabou de ser reservado
    });

    it("só administrador ativo; só membro da equipe da MESMA organização; nunca aprovador (cliente)", async () => {
      const id = await newAuthUser("reenvio-regras@luvi.test");
      await add(IDS.admin, id, "Pessoa Regras", "reenvio-regras@luvi.test", "atendimento");
      await backdate(id);
      for (const actor of [IDS.designer, IDS.atendimento, IDS.userClienteA]) expect(await code(reserve(actor, id)), actor).toBe("42501");
      expect(await code(db.asAnon(() => db.query("select * from public.reserve_team_invite_resend($1)", [id])))).toBe("42501");
      expect(await code(db.asService(() => db.query("select * from public.reserve_team_invite_resend($1)", [id])))).toBe("42501");
      expect(await code(reserve(IDS.staffOutraOrg, id))).toBe("P0002"); // administrador de outra agência não enxerga
      expect(await code(reserve(IDS.admin, IDS.userClienteA))).toBe("P0002"); // aprovador de cliente não é da equipe
      expect(await code(reserve(IDS.admin, uid(888888)))).toBe("P0002");
      expect((await events(id)).map((e) => e.action)).toEqual(["team_member.invited"]); // nada foi reservado
    });
  });
});
