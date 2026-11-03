// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCKED_CONTENT_FIELDS } from "@/lib/materials/schema";
import { IDS, createMaterial, createTestDb, errorOf, seedBase, type TestDb } from "./harness";

/**
 * Módulo 3, etapa B (migrations 20261104120000 e 20261104120100): cadastro de materiais NO BANCO.
 * Grants por coluna, RLS por papel, trava de conteúdo, material aprovado sem volta silenciosa a
 * rascunho, guarda de cliente arquivado, exclusão e auditoria sem texto livre.
 */

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
  await seedBase(db);
}, 180_000);

afterAll(async () => {
  await db.close();
});

const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows;
const hasColumn = async (role: string, column: string, priv: string) =>
  (await q<{ ok: boolean }>(`select has_column_privilege('${role}', 'public.materials', '${column}', '${priv}') as ok`))[0].ok;

interface NewMaterial {
  projectId?: string;
  clientId?: string;
  title?: string;
  caption?: string;
  aspectRatio?: string | null;
  publishDate?: string | null;
  createdBy?: string | null;
}

const insertSql = `insert into public.materials (project_id, client_id, title, type, created_by, caption, aspect_ratio, publish_date)
  values ($1, $2, $3, 'imagem', $4, $5, $6, $7) returning id`;

const insertParams = (userId: string, m: NewMaterial) => [
  m.projectId ?? IDS.projetoA,
  m.clientId ?? IDS.clienteA,
  m.title ?? "Material de teste",
  m.createdBy === undefined ? userId : m.createdBy,
  m.caption ?? "",
  m.aspectRatio ?? null,
  m.publishDate ?? null,
];

/** Cadastra como `userId`; devolve o id ou a mensagem de erro. */
async function insertAs(userId: string, m: NewMaterial = {}): Promise<{ id?: string; error?: string }> {
  try {
    const rows = await db.asUser(userId, async () => (await db.query<{ id: string }>(insertSql, insertParams(userId, m))).rows);
    return { id: rows[0].id };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

async function draft(m: NewMaterial = {}): Promise<string> {
  const result = await insertAs(IDS.designer, m);
  if (!result.id) throw new Error(result.error);
  return result.id;
}

const setStatus = (id: string, status: string) =>
  db.query("update public.materials set status = $2 where id = $1", [id, status]);

const updateAs = (userId: string, sql: string, params: unknown[]) =>
  db.asUser(userId, () => errorOf(() => db.query(sql, params)));

const events = (entityId: string) =>
  q<{ action: string; entity_type: string; actor_profile_id: string | null; metadata: Record<string, unknown> }>(
    "select action, entity_type, actor_profile_id, metadata from public.audit_events where entity_id = $1 order by id",
    [entityId],
  );

describe("grants por coluna de materials", () => {
  it("o app grava legenda, proporção e data de publicação (insert e update)", async () => {
    for (const col of ["caption", "aspect_ratio", "publish_date"]) {
      expect(await hasColumn("authenticated", col, "INSERT"), `${col} insert`).toBe(true);
      expect(await hasColumn("authenticated", col, "UPDATE"), `${col} update`).toBe(true);
    }
  });

  it("identificadores, status, tipo, autoria e carimbos NÃO são alteráveis pelo app", async () => {
    for (const col of ["id", "project_id", "client_id", "type", "status", "created_by", "created_at", "updated_at"]) {
      expect(await hasColumn("authenticated", col, "UPDATE"), `${col} update`).toBe(false);
    }
    for (const col of ["id", "status", "created_at", "updated_at"]) {
      expect(await hasColumn("authenticated", col, "INSERT"), `${col} insert`).toBe(false);
    }
  });

  it("na prática: status, cliente, projeto, tipo e autor são recusados em UPDATE, e status em INSERT", async () => {
    const id = await draft();
    for (const set of [
      "status = 'aprovado'",
      `client_id = '${IDS.clienteB}'`,
      `project_id = '${IDS.projetoB}'`,
      "type = 'video'",
      `created_by = '${IDS.admin}'`,
    ]) {
      for (const user of [IDS.designer, IDS.atendimento, IDS.admin]) {
        expect(await updateAs(user, `update public.materials set ${set} where id = $1`, [id]), `${user} ${set}`).toMatch(
          /permission denied/,
        );
      }
    }
    const insertStatus = await db.asUser(IDS.designer, () =>
      errorOf(() =>
        db.query(
          "insert into public.materials (project_id, client_id, title, type, status, created_by) values ($1,$2,'Com status','imagem','aprovado',$3)",
          [IDS.projetoA, IDS.clienteA, IDS.designer],
        ),
      ),
    );
    expect(insertStatus).toMatch(/permission denied/);
  });

  it("anônimo não toca em materials", async () => {
    expect(await db.asAnon(() => errorOf(() => db.query("select 1 from public.materials")))).toMatch(/permission denied/);
    expect(await db.asAnon(() => errorOf(() => db.query(insertSql, insertParams(IDS.designer, {}))))).toMatch(/permission denied/);
  });
});

describe("cadastro de material", () => {
  it("admin, atendimento e designer cadastram em cliente da própria organização", async () => {
    for (const user of [IDS.admin, IDS.atendimento, IDS.designer]) {
      const r = await insertAs(user, { title: `Material de ${user.slice(-2)}` });
      expect(r.error, user).toBeUndefined();
    }
  });

  it("aprovador (papel cliente) e staff de outra organização são barrados pela RLS", async () => {
    expect((await insertAs(IDS.userClienteA)).error).toMatch(/row-level security/);
    expect((await insertAs(IDS.staffOutraOrg, { createdBy: IDS.staffOutraOrg })).error).toMatch(/row-level security/);
  });

  it("created_by tem de ser o próprio usuário", async () => {
    expect((await insertAs(IDS.designer, { createdBy: IDS.admin })).error).toMatch(/row-level security/);
    expect((await insertAs(IDS.designer, { createdBy: null })).error).toMatch(/row-level security/);
  });

  it("projeto de outro cliente é recusado (chave estrangeira composta)", async () => {
    const r = await insertAs(IDS.designer, { clientId: IDS.clienteA, projectId: IDS.projetoB });
    expect(r.error).toMatch(/foreign key|violates/i);
  });

  it("legenda: 2200 caracteres passam, 2201 não", async () => {
    expect((await insertAs(IDS.designer, { caption: "a".repeat(2200) })).error).toBeUndefined();
    expect((await insertAs(IDS.designer, { caption: "a".repeat(2201) })).error).toMatch(/violates check constraint/);
  });

  it("proporção: só 1:1, 4:5, 9:16, outro ou vazio", async () => {
    for (const ok of ["1:1", "4:5", "9:16", "outro", null]) {
      expect((await insertAs(IDS.designer, { aspectRatio: ok })).error, String(ok)).toBeUndefined();
    }
    for (const bad of ["2:3", "16:9", "", "1x1"]) {
      expect((await insertAs(IDS.designer, { aspectRatio: bad })).error, bad).toMatch(/violates check constraint/);
    }
  });

  it("título curto demais é recusado", async () => {
    expect((await insertAs(IDS.designer, { title: "A" })).error).toMatch(/violates check constraint/);
  });

  it("cliente arquivado não recebe material novo, nem do servidor (service_role)", async () => {
    await db.query("update public.clients set active = false where id = $1", [IDS.clienteB]);
    try {
      const staff = await insertAs(IDS.designer, { clientId: IDS.clienteB, projectId: IDS.projetoB });
      expect(staff.error).toMatch(/cliente arquivado/);
      const server = await db.asService(() =>
        errorOf(() => db.query(insertSql, [IDS.projetoB, IDS.clienteB, "Pelo servidor", IDS.admin, "", null, null])),
      );
      expect(server).toMatch(/cliente arquivado/);
    } finally {
      await db.query("update public.clients set active = true where id = $1", [IDS.clienteB]);
    }
    expect((await insertAs(IDS.designer, { clientId: IDS.clienteB, projectId: IDS.projetoB })).error).toBeUndefined();
  });
});

describe("edição e trava de conteúdo", () => {
  it("em rascunho, todo o conteúdo e as datas podem mudar", async () => {
    const id = await draft({ title: "Antes" });
    const err = await updateAs(
      IDS.atendimento,
      `update public.materials set title = 'Depois', description = 'd', caption = 'c', channel = 'Instagram',
         aspect_ratio = '4:5', publish_date = '2026-12-01', due_date = '2026-11-20' where id = $1`,
      [id],
    );
    expect(err).toBeNull();
    const [row] = await q<{ title: string; aspect_ratio: string }>("select title, aspect_ratio from public.materials where id = $1", [id]);
    expect(row).toEqual({ title: "Depois", aspect_ratio: "4:5" });
  });

  it("a lista de campos travados do app é exatamente a do banco", () => {
    expect([...LOCKED_CONTENT_FIELDS].sort()).toEqual(["aspect_ratio", "caption", "channel", "description", "title"]);
  });

  for (const status of ["aguardando", "alteracao", "aprovado"]) {
    it(`com status "${status}", título, descrição, legenda, canal e proporção NÃO mudam (nem para o admin)`, async () => {
      const id = await draft({ title: "Travado", caption: "legenda" });
      await setStatus(id, status);
      const values: Record<string, string> = {
        title: "'Outro título'",
        description: "'Outra descrição'",
        caption: "'Outra legenda'",
        channel: "'TikTok'",
        aspect_ratio: "'9:16'",
      };
      for (const field of LOCKED_CONTENT_FIELDS) {
        for (const user of [IDS.designer, IDS.admin]) {
          expect(await updateAs(user, `update public.materials set ${field} = ${values[field]} where id = $1`, [id]), `${status} ${field}`).toMatch(
            /já enviado para aprovação/,
          );
        }
      }
      // O servidor também respeita a trava.
      expect(await db.asService(() => errorOf(() => db.query("update public.materials set caption = 'x' where id = $1", [id])))).toMatch(
        /já enviado para aprovação/,
      );
      const [row] = await q<{ title: string; caption: string }>("select title, caption from public.materials where id = $1", [id]);
      expect(row).toEqual({ title: "Travado", caption: "legenda" });
    });

    it(`com status "${status}", as datas de prazo e de publicação continuam editáveis`, async () => {
      const id = await draft();
      await setStatus(id, status);
      expect(await updateAs(IDS.designer, "update public.materials set due_date = '2026-11-25', publish_date = '2026-12-05' where id = $1", [id])).toBeNull();
      const [row] = await q<{ publish_date: string }>("select publish_date::text from public.materials where id = $1", [id]);
      expect(row.publish_date).toBe("2026-12-05");
    });
  }

  it("voltando a rascunho (função de aprovação ou nova versão), o conteúdo destrava", async () => {
    const id = await draft();
    await setStatus(id, "alteracao");
    await setStatus(id, "rascunho");
    expect(await updateAs(IDS.designer, "update public.materials set title = 'Liberado' where id = $1", [id])).toBeNull();
  });

  it("staff de outra organização e aprovador não alteram material (0 linhas, sem erro de existência)", async () => {
    const id = await draft({ title: "Alheio" });
    for (const user of [IDS.staffOutraOrg, IDS.userClienteA]) {
      const rows = await db.asUser(user, async () =>
        (await db.query("update public.materials set title = 'Invadido' where id = $1 returning id", [id])).rows,
      );
      expect(rows, user).toHaveLength(0);
    }
  });
});

describe("material aprovado não volta a rascunho por uma simples nova versão", () => {
  const addVersion = (userId: string, materialId: string) =>
    db.asUser(userId, () =>
      errorOf(() =>
        db.query("insert into public.material_versions (material_id, client_id, note, created_by) values ($1,$2,'v2',$3)", [
          materialId,
          IDS.clienteA,
          userId,
        ]),
      ),
    );

  it("recusa a nova versão de material aprovado e preserva status, versões e decisões", async () => {
    const m = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA });
    await setStatus(m.materialId, "aprovado");
    for (const user of [IDS.designer, IDS.admin]) {
      expect(await addVersion(user, m.materialId), user).toMatch(/operação de revisão/);
    }
    expect(await db.asService(() => errorOf(() => db.query("insert into public.material_versions (material_id, client_id) values ($1,$2)", [m.materialId, IDS.clienteA])))).toMatch(
      /operação de revisão/,
    );
    const [status] = await q<{ status: string }>("select status from public.materials where id = $1", [m.materialId]);
    expect(status.status).toBe("aprovado");
    expect(await q("select 1 from public.material_versions where material_id = $1", [m.materialId])).toHaveLength(1);
  });

  // ---- Tíquete de revisão (app.revision_tickets): o que impede contornar a proteção do material aprovado.
  /** Roda o SQL numa transação como dono do banco; confirma se deu certo, desfaz se falhar. Devolve o erro ou null. */
  async function inTx(sql: string): Promise<string | null> {
    try {
      await db.exec(`begin; ${sql}`);
      await db.exec("commit");
      return null;
    } catch (error) {
      await db.exec("rollback");
      return (error as Error).message;
    }
  }
  const insertVersionSql = (materialId: string, by: string) =>
    `insert into public.material_versions (material_id, client_id, note, created_by) values ('${materialId}', '${IDS.clienteA}', 'revisão', '${by}');`;
  const asDesignerSql = `select set_config('request.jwt.claim.sub', '${IDS.designer}', true); set local role authenticated;`;
  const approved = async () => {
    const m = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA });
    await setStatus(m.materialId, "aprovado");
    return m.materialId;
  };
  const statusOf = async (id: string) => (await q<{ status: string }>("select status from public.materials where id = $1", [id]))[0].status;
  const versionCount = async (id: string) => (await q("select 1 from public.material_versions where material_id = $1", [id])).length;
  const ticketsFor = async (id: string) => (await q("select 1 from app.revision_tickets where material_id = $1", [id])).length;

  it("o antigo sinal app.revision_in_progress NÃO destrava nada, nem como dono, nem como designer, nem em nível de sessão", async () => {
    const id = await approved();
    expect(await inTx(`select set_config('app.revision_in_progress', 'on', true); ${insertVersionSql(id, IDS.designer)}`)).toMatch(/operação de revisão/);
    expect(
      await inTx(`select set_config('app.revision_in_progress', 'on', true); ${asDesignerSql} ${insertVersionSql(id, IDS.designer)}`),
    ).toMatch(/operação de revisão/);
    await db.exec("select set_config('app.revision_in_progress', 'on', false)"); // vaza para a sessão inteira
    try {
      expect(await addVersion(IDS.designer, id)).toMatch(/operação de revisão/);
      expect(await db.asService(() => errorOf(() => db.query(`update public.materials set status = 'rascunho' where id = $1`, [id])))).toMatch(
        /operação de revisão/,
      );
    } finally {
      await db.exec("select set_config('app.revision_in_progress', '', false)");
    }
    expect(await statusOf(id)).toBe("aprovado");
    expect(await versionCount(id)).toBe(1);
  });

  it("com o tíquete (emitido pela função interna) a revisão cria a v2, volta a rascunho, consome o tíquete e preserva a v1 e seus arquivos", async () => {
    const id = await approved();
    expect(await inTx(`select app.grant_revision_ticket('${id}'); ${insertVersionSql(id, IDS.designer)}`)).toBeNull();
    const versions = await q<{ number: number }>("select number from public.material_versions where material_id = $1 order by number", [id]);
    expect(versions.map((v) => v.number)).toEqual([1, 2]);
    expect(await statusOf(id)).toBe("rascunho");
    expect(await ticketsFor(id)).toBe(0); // uso único
    expect(await q("select 1 from public.material_files where material_id = $1", [id])).toHaveLength(1); // arquivo da v1 intacto
    // Depois da revisão, aprovar de novo e tentar outra versão volta a exigir tíquete.
    await setStatus(id, "aprovado");
    expect(await addVersion(IDS.designer, id)).toMatch(/operação de revisão/);
  });

  it("o tíquete vale para quem agiu: emitido para o designer, o designer usa; emitido sem usuário (servidor), o designer não usa", async () => {
    const mine = await approved();
    expect(
      await inTx(`select set_config('request.jwt.claim.sub', '${IDS.designer}', true); select app.grant_revision_ticket('${mine}'); ${asDesignerSql} ${insertVersionSql(mine, IDS.designer)}`),
    ).toBeNull();
    expect(await statusOf(mine)).toBe("rascunho");

    const other = await approved();
    expect(await inTx(`select app.grant_revision_ticket('${other}'); ${asDesignerSql} ${insertVersionSql(other, IDS.designer)}`)).toMatch(
      /operação de revisão/,
    );
    expect(await statusOf(other)).toBe("aprovado");
  });

  it("o tíquete é de UM material: o de outro material não serve", async () => {
    const a = await approved();
    const b = await approved();
    expect(await inTx(`select app.grant_revision_ticket('${a}'); ${insertVersionSql(b, IDS.designer)}`)).toMatch(/operação de revisão/);
    expect(await statusOf(b)).toBe("aprovado");
    expect(await versionCount(b)).toBe(1);
  });

  it("o tíquete é de UMA transação: um tíquete de transação anterior não serve e é limpo na próxima emissão", async () => {
    const a = await approved();
    expect(await inTx(`select app.grant_revision_ticket('${a}');`)).toBeNull(); // confirmado, mas sem uso
    expect(await ticketsFor(a)).toBe(1);
    expect(await addVersion(IDS.designer, a)).toMatch(/operação de revisão/);
    expect(await inTx(insertVersionSql(a, IDS.designer))).toMatch(/operação de revisão/);
    const b = await approved();
    expect(await inTx(`select app.grant_revision_ticket('${b}');`)).toBeNull();
    expect(await ticketsFor(a)).toBe(0); // limpo pela emissão seguinte
    await inTx(`delete from app.revision_tickets;`);
  });

  it("os papéis da API não emitem, consultam nem forjam tíquetes (anon, authenticated e service_role)", async () => {
    const id = await approved();
    const attempts = [
      `select app.grant_revision_ticket('${id}')`,
      `select app.has_revision_ticket('${id}')`,
      `insert into app.revision_tickets (material_id, txid, actor) values ('${id}', txid_current(), null)`,
      "select * from app.revision_tickets",
      "delete from app.revision_tickets",
    ];
    for (const run of [(fn: () => Promise<string | null>) => db.asUser(IDS.admin, fn), (fn: () => Promise<string | null>) => db.asService(fn), (fn: () => Promise<string | null>) => db.asAnon(fn)]) {
      for (const sql of attempts) {
        expect(await run(() => errorOf(() => db.query(sql))), sql).toMatch(/permission denied/);
      }
    }
    expect(await versionCount(id)).toBe(1);
    expect(await q("select relrowsecurity from pg_class where oid = 'app.revision_tickets'::regclass")).toEqual([{ relrowsecurity: true }]);
  });

  it("material aprovado: UPDATE direto de status é recusado para todos; com tíquete só vai para rascunho, uma vez", async () => {
    const id = await approved();
    for (const target of ["rascunho", "aguardando", "alteracao"]) {
      expect(await db.asService(() => errorOf(() => db.query("update public.materials set status = $2 where id = $1", [id, target]))), target).toMatch(
        /operação de revisão/,
      );
      expect(await errorOf(() => db.query("update public.materials set status = $2 where id = $1", [id, target])), `dono ${target}`).toMatch(/operação de revisão/);
    }
    // Tíquete válido, mas destino que não é rascunho: recusado.
    expect(await inTx(`select app.grant_revision_ticket('${id}'); update public.materials set status = 'alteracao' where id = '${id}';`)).toMatch(/operação de revisão/);
    // Tíquete válido e rascunho: passa e o tíquete some; um segundo retorno na mesma transação exige novo tíquete.
    expect(
      await inTx(`select app.grant_revision_ticket('${id}'); update public.materials set status = 'rascunho' where id = '${id}'; update public.materials set status = 'aprovado' where id = '${id}'; update public.materials set status = 'rascunho' where id = '${id}';`),
    ).toMatch(/operação de revisão/);
    expect(await inTx(`select app.grant_revision_ticket('${id}'); update public.materials set status = 'rascunho' where id = '${id}';`)).toBeNull();
    expect(await statusOf(id)).toBe("rascunho");
    expect(await ticketsFor(id)).toBe(0);
  });

  it("as funções do tíquete e do status não são executáveis por nenhum papel da API", async () => {
    for (const fn of ["app.grant_revision_ticket(uuid)", "app.has_revision_ticket(uuid)", "app.materials_guard_status()", "app.materials_guard_content()"]) {
      for (const role of ["anon", "authenticated", "service_role"]) {
        const [row] = await q<{ ok: boolean }>(`select has_function_privilege('${role}', '${fn}', 'EXECUTE') as ok`);
        expect(row.ok, `${role} ${fn}`).toBe(false);
      }
    }
  });

  it("o fluxo já existente continua: alteração pedida -> nova versão -> rascunho", async () => {
    const m = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA });
    await setStatus(m.materialId, "alteracao");
    expect(await addVersion(IDS.designer, m.materialId)).toBeNull();
    const [status] = await q<{ status: string }>("select status from public.materials where id = $1", [m.materialId]);
    expect(status.status).toBe("rascunho");
  });
});

describe("exclusão controlada", () => {
  const del = (userId: string, id: string) =>
    db.asUser(userId, async () => {
      try {
        return { rows: (await db.query("delete from public.materials where id = $1 returning id", [id])).rows.length, error: null };
      } catch (error) {
        return { rows: 0, error: (error as Error).message };
      }
    });

  it("rascunho vazio (sem versões) pode ser excluído pela equipe", async () => {
    for (const user of [IDS.designer, IDS.atendimento, IDS.admin]) {
      const id = await draft({ title: `Excluir ${user.slice(-2)}` });
      expect(await del(user, id), user).toEqual({ rows: 1, error: null });
      expect(await q("select 1 from public.materials where id = $1", [id])).toHaveLength(0);
    }
  });

  it("rascunho com versão não é excluído (a chave estrangeira protege o histórico)", async () => {
    const m = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA });
    const result = await del(IDS.designer, m.materialId);
    expect(result.error).toMatch(/foreign key|violates/i);
    expect(await q("select 1 from public.materials where id = $1", [m.materialId])).toHaveLength(1);
  });

  it("material fora de rascunho ou já enviado não é excluído (a RLS filtra)", async () => {
    for (const status of ["aguardando", "alteracao", "aprovado"]) {
      const id = await draft();
      await setStatus(id, status);
      expect((await del(IDS.admin, id)).rows, status).toBe(0);
      expect(await q("select 1 from public.materials where id = $1", [id])).toHaveLength(1);
    }
  });

  it("aprovador, staff de outra organização e anônimo não excluem", async () => {
    const id = await draft();
    expect((await del(IDS.userClienteA, id)).rows).toBe(0);
    expect((await del(IDS.staffOutraOrg, id)).rows).toBe(0);
    expect(await db.asAnon(() => errorOf(() => db.query("delete from public.materials where id = $1", [id])))).toMatch(/permission denied/);
    expect(await q("select 1 from public.materials where id = $1", [id])).toHaveLength(1);
  });
});

describe("auditoria de materiais", () => {
  const ALLOWED_KEYS = new Set(["client_id", "actor_role", "changed", "status_from", "status_to"]);

  it("registra criação, edição, mudança de status e exclusão, com o autor e sem texto livre", async () => {
    const secret = "Titulo-secreto-1234";
    const id = await draft({ title: secret, caption: "Legenda secreta 5678" });
    await db.asUser(IDS.atendimento, () =>
      db.query("update public.materials set title = 'Outro-nome-9999', caption = 'Outra legenda 0000', channel = 'Instagram' where id = $1", [id]),
    );
    await db.asUser(IDS.designer, () => db.query("update public.materials set publish_date = '2026-12-10' where id = $1", [id]));
    await setStatus(id, "aguardando");
    await setStatus(id, "rascunho");
    await db.asUser(IDS.admin, () => db.query("delete from public.materials where id = $1", [id]));

    const list = await events(id);
    expect(list.map((e) => e.action)).toEqual([
      "material.created",
      "material.updated",
      "material.updated",
      "material.updated",
      "material.updated",
      "material.deleted",
    ]);
    expect(list.every((e) => e.entity_type === "material")).toBe(true);
    expect(list[0].actor_profile_id).toBe(IDS.designer);
    expect(list[1].actor_profile_id).toBe(IDS.atendimento);
    expect(list[1].metadata).toMatchObject({ client_id: IDS.clienteA, actor_role: "atendimento", changed: ["caption", "channel", "title"] });
    expect(list[2].metadata).toMatchObject({ actor_role: "designer", changed: ["publish_date"] });
    expect(list[3].metadata).toMatchObject({ changed: ["status"], status_from: "rascunho", status_to: "aguardando" });
    expect(list[4].metadata).toMatchObject({ status_from: "aguardando", status_to: "rascunho" });
    expect(list[5].actor_profile_id).toBe(IDS.admin);
    expect(list[5].metadata).toMatchObject({ client_id: IDS.clienteA, actor_role: "admin", status_from: "rascunho" });

    for (const e of list) {
      for (const key of Object.keys(e.metadata)) expect(ALLOWED_KEYS.has(key), `${e.action}: ${key}`).toBe(true);
      const text = JSON.stringify(e.metadata);
      for (const leak of [secret, "Legenda secreta", "Outro-nome", "Outra legenda", "Instagram"]) {
        expect(text, `${e.action} vazou "${leak}"`).not.toContain(leak);
      }
    }
  });

  it("um UPDATE que não muda nada gera evento só se alguma coluna mudou (updated_at sozinho não conta)", async () => {
    const id = await draft({ title: "Sem mudança" });
    const antes = (await events(id)).length;
    await db.asUser(IDS.designer, () => db.query("update public.materials set title = title where id = $1", [id]));
    expect((await events(id)).length).toBe(antes);
  });

  it("só o administrador lê a auditoria; a equipe comum e o aprovador não", async () => {
    const id = await draft();
    const count = (user: string) =>
      db.asUser(user, async () => (await db.query("select 1 from public.audit_events where entity_id = $1", [id])).rows.length);
    expect(await count(IDS.admin)).toBeGreaterThan(0);
    for (const user of [IDS.designer, IDS.atendimento, IDS.userClienteA]) expect(await count(user), user).toBe(0);
  });

  it("o app não grava nem apaga auditoria", async () => {
    const id = await draft();
    expect(await updateAs(IDS.admin, "delete from public.audit_events where entity_id = $1", [id])).toMatch(/permission denied/);
    expect(await updateAs(IDS.admin, "insert into public.audit_events (organization_id, action, entity_type) values ($1,'material.fake','material')", [IDS.orgLuvi])).toMatch(
      /permission denied/,
    );
  });
});

describe("o aprovador só vê material enviado", () => {
  it("rascunho é invisível no portal; o material enviado aparece com a legenda", async () => {
    const hidden = await draft({ title: "Rascunho invisível", caption: "segredo do rascunho" });
    const sent = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA, sent: true, title: "Enviado ao cliente" });
    const rows = await db.asUser(IDS.userClienteA, async () =>
      (await db.query<{ id: string; caption: string }>("select id, caption from public.materials")).rows,
    );
    expect(rows.map((r) => r.id)).toContain(sent.materialId);
    expect(rows.map((r) => r.id)).not.toContain(hidden);
    expect(await db.asUser(IDS.userClienteB, async () => (await db.query("select 1 from public.materials where id = $1", [sent.materialId])).rows)).toHaveLength(0);
  });
});

/**
 * Modelo da futura operação de revisão (etapa D): uma função SECURITY DEFINER, exposta ao app, que emite o
 * tíquete e cria a versão na MESMA transação. Definida só aqui, no banco de testes (não é uma migration), para
 * provar que o desenho funciona sem abrir nada à API e sem tocar no histórico.
 */
describe("modelo da operação de revisão (SECURITY DEFINER)", () => {
  beforeAll(async () => {
    await db.exec(`
      create function public.zz_test_start_revision(p_material uuid) returns uuid
      language plpgsql security definer set search_path = '' as $$
      declare v_client uuid; v_id uuid;
      begin
        select client_id into v_client from public.materials where id = p_material;
        if v_client is null or not app.staff_can_access(v_client) then
          raise exception 'sem permissão';
        end if;
        perform app.grant_revision_ticket(p_material);
        insert into public.material_versions (material_id, client_id, note, created_by)
        values (p_material, v_client, 'revisão', auth.uid()) returning id into v_id;
        return v_id;
      end $$;
      revoke execute on function public.zz_test_start_revision(uuid) from public, anon;
      grant execute on function public.zz_test_start_revision(uuid) to authenticated;
    `);
  });

  const start = (userId: string, materialId: string) =>
    db.asUser(userId, () => errorOf(() => db.query("select public.zz_test_start_revision($1)", [materialId])));

  /** Material enviado e aprovado de verdade (função de decisão do banco). */
  async function approvedForReal() {
    const m = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA, sent: true });
    await db.asUser(IDS.userClienteA, () => db.query("select public.decide_as_approver($1,'aprovado','')", [m.requestId]));
    return m;
  }
  const history = async (materialId: string) => ({
    decisions: await q("select to_jsonb(d) as r from public.decisions d where material_id = $1 order by id", [materialId]),
    requests: await q("select to_jsonb(r) as r from public.approval_requests r where material_id = $1 order by id", [materialId]),
    versions: await q("select to_jsonb(v) as r from public.material_versions v where material_id = $1 and number = 1", [materialId]),
    files: await q("select to_jsonb(f) as r from public.material_files f where material_id = $1 order by id", [materialId]),
  });

  it("a função emite e consome o tíquete na mesma transação: equipe revisa; aprovador, outra organização e anônimo não", async () => {
    const m = await approvedForReal();
    expect((await q<{ status: string }>("select status from public.materials where id = $1", [m.materialId]))[0].status).toBe("aprovado");

    expect(await start(IDS.userClienteA, m.materialId)).toMatch(/sem permissão/);
    expect(await start(IDS.staffOutraOrg, m.materialId)).toMatch(/sem permissão/);
    expect(await db.asAnon(() => errorOf(() => db.query("select public.zz_test_start_revision($1)", [m.materialId])))).toMatch(/permission denied/);
    expect((await q("select 1 from public.material_versions where material_id = $1", [m.materialId])).length).toBe(1);

    expect(await start(IDS.designer, m.materialId)).toBeNull();
    expect((await q<{ status: string }>("select status from public.materials where id = $1", [m.materialId]))[0].status).toBe("rascunho");
    expect((await q<{ number: number }>("select number from public.material_versions where material_id = $1 order by number", [m.materialId])).map((r) => r.number)).toEqual([1, 2]);
    expect(await q("select 1 from app.revision_tickets")).toHaveLength(0); // consumido; nada sobra
  });

  it("a existência da função não abre nada: o usuário continua sem emitir tíquete nem alterar o material aprovado", async () => {
    const m = await approvedForReal();
    for (const sql of [
      "select app.grant_revision_ticket($1)",
      "insert into app.revision_tickets (material_id, txid) values ($1, txid_current())",
      "update public.materials set status = 'rascunho' where id = $1",
      "update public.materials set title = 'Alterado' where id = $1",
      `insert into public.material_versions (material_id, client_id, created_by) select $1, '${IDS.clienteA}', '${IDS.designer}'`,
    ]) {
      expect(await db.asUser(IDS.designer, () => errorOf(() => db.query(sql, [m.materialId]))), sql).toMatch(
        /permission denied|operação de revisão|já enviado para aprovação/,
      );
    }
    expect((await q<{ status: string }>("select status from public.materials where id = $1", [m.materialId]))[0].status).toBe("aprovado");
  });

  it("o histórico (versão 1, arquivos, solicitação e decisão) permanece idêntico e imutável depois da revisão", async () => {
    const m = await approvedForReal();
    const before = await history(m.materialId);
    expect(before.decisions).toHaveLength(1);
    expect(await start(IDS.atendimento, m.materialId)).toBeNull();
    expect(await history(m.materialId)).toEqual(before);

    // Imutáveis para qualquer um, inclusive o dono do banco.
    expect(await errorOf(() => db.query("update public.material_versions set note = 'x' where id = $1", [m.versionId]))).toMatch(/imutável/);
    expect(await errorOf(() => db.query("delete from public.material_versions where id = $1", [m.versionId]))).toMatch(/imutável/);
    expect(await errorOf(() => db.query("update public.decisions set decision = 'alteracao' where material_id = $1", [m.materialId]))).toMatch(/imutável/);
    expect(await errorOf(() => db.query("delete from public.decisions where material_id = $1", [m.materialId]))).toMatch(/imutável/);
    // A equipe não mexe nos arquivos de uma versão já enviada.
    const del = await db.asUser(IDS.designer, async () =>
      (await db.query("delete from public.material_files where material_id = $1 and version_id = $2 returning id", [m.materialId, m.versionId])).rows,
    );
    expect(del).toHaveLength(0);
    expect(await history(m.materialId)).toEqual(before);
  });

  it("dono, privilégios e SECURITY DEFINER: mesmo dono da tabela, search_path vazio, sem EXECUTE para a API e RLS ligada", async () => {
    const fns = await q<{ proname: string; prosecdef: boolean; owner: string; cfg: string[] | null }>(
      `select p.proname, p.prosecdef, pg_get_userbyid(p.proowner) as owner, p.proconfig as cfg
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname in ('grant_revision_ticket', 'has_revision_ticket', 'materials_guard_status')
       order by 1`,
    );
    expect(fns).toHaveLength(3);
    const [table] = await q<{ owner: string; rls: boolean; forced: boolean }>(
      "select pg_get_userbyid(relowner) as owner, relrowsecurity as rls, relforcerowsecurity as forced from pg_class where oid = 'app.revision_tickets'::regclass",
    );
    for (const fn of fns) {
      expect(fn.prosecdef, fn.proname).toBe(true);
      expect(fn.cfg, fn.proname).toContain('search_path=""');
      expect(fn.owner, fn.proname).toBe(table.owner); // o dono das funções é quem acessa a tabela (a RLS não o barra)
    }
    expect(table.rls).toBe(true);
    expect(table.forced).toBe(false); // sem FORCE: só o dono (as funções) passa; ninguém mais tem política nem privilégio
    expect(await q("select 1 from pg_policies where schemaname = 'app' and tablename = 'revision_tickets'")).toHaveLength(0);
  });

  it("limpeza do modelo de teste", async () => {
    await db.exec("drop function public.zz_test_start_revision(uuid)");
  });
});
