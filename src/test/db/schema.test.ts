// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDS, createMaterial, createTestDb, errorOf, seedBase, uid, type TestDb } from "./harness";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
  await seedBase(db);
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("migrations", () => {
  it("aplicam por completo e ligam RLS em todas as tabelas de negócio", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' order by 1`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(15);
    const semRls = rows.filter((r) => !r.relrowsecurity).map((r) => r.relname);
    expect(semRls).toEqual([]);
  });

  it("cria o bucket de materiais como privado", async () => {
    const { rows } = await db.query<{ public: boolean; file_size_limit: string }>(
      "select public, file_size_limit from storage.buckets where id = 'materials'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].public).toBe(false);
  });
});

describe("constraints de arquivos", () => {
  it("exige que o caminho comece pelo client_id (liga o bucket ao isolamento)", async () => {
    const m = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA });
    const erro = await errorOf(() =>
      db.query(
        `insert into public.material_files (version_id, material_id, client_id, slide_position, kind,
           storage_path, original_name, mime_type, size_bytes)
         values ($1,$2,$3,2,'imagem',$4,'x.png','image/png',10)`,
        [m.versionId, m.materialId, IDS.clienteA, `${IDS.clienteB}/outro/caminho.png`],
      ),
    );
    expect(erro).toMatch(/check/i);
  });

  it("rejeita tipos MIME fora da lista permitida", async () => {
    const m = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA });
    const erro = await errorOf(() =>
      db.query(
        `insert into public.material_files (version_id, material_id, client_id, slide_position, kind,
           storage_path, original_name, mime_type, size_bytes)
         values ($1,$2,$3,2,'imagem',$4,'x.exe','application/x-msdownload',10)`,
        [m.versionId, m.materialId, IDS.clienteA, `${IDS.clienteA}/a/b/x.exe`],
      ),
    );
    expect(erro).toMatch(/check/i);
  });

  it("rejeita MIME incompatível com o tipo e tamanhos acima do limite", async () => {
    const m = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA });
    const insert = (kind: string, mime: string, size: number, n: number) =>
      errorOf(() =>
        db.query(
          `insert into public.material_files (version_id, material_id, client_id, slide_position, kind,
             storage_path, original_name, mime_type, size_bytes)
           values ($1,$2,$3,$4,$5,$6,'f','${mime}',$7)`,
          [m.versionId, m.materialId, IDS.clienteA, n, kind, `${IDS.clienteA}/p/${n}`, size],
        ),
      );
    expect(await insert("imagem", "video/mp4", 10, 2)).toMatch(/check/i);
    expect(await insert("imagem", "image/png", 20 * 1024 * 1024 + 1, 3)).toMatch(/check/i);
    expect(await insert("pdf", "application/pdf", 50 * 1024 * 1024 + 1, 4)).toMatch(/check/i);
    expect(await insert("imagem", "image/png", 0, 5)).toMatch(/check/i);
  });

  it("impede arquivo cuja versão pertence a outro cliente (FK composta)", async () => {
    const m = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA });
    const erro = await errorOf(() =>
      db.query(
        `insert into public.material_files (version_id, material_id, client_id, slide_position, kind,
           storage_path, original_name, mime_type, size_bytes)
         values ($1,$2,$3,2,'imagem',$4,'x.png','image/png',10)`,
        [m.versionId, m.materialId, IDS.clienteB, `${IDS.clienteB}/x/y.png`],
      ),
    );
    expect(erro).toMatch(/foreign key|violates/i);
  });
});

describe("versões", () => {
  it("numera automaticamente e nunca apaga a anterior", async () => {
    const m = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA });
    await db.query(
      "insert into public.material_versions (material_id, client_id, note) values ($1,$2,'v2')",
      [m.materialId, IDS.clienteA],
    );
    const { rows } = await db.query<{ number: number }>(
      "select number from public.material_versions where material_id = $1 order by number",
      [m.materialId],
    );
    expect(rows.map((r) => r.number)).toEqual([1, 2]);
  });

  it("é imutável (update e delete bloqueados mesmo para o superusuário)", async () => {
    const m = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA });
    expect(await errorOf(() => db.query("update public.material_versions set note='x' where id=$1", [m.versionId]))).toMatch(/imutável/);
    expect(await errorOf(() => db.query("delete from public.material_versions where id=$1", [m.versionId]))).toMatch(/imutável/);
  });

  it("não permite nova versão enquanto há solicitação aberta", async () => {
    const m = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA, sent: true });
    const erro = await errorOf(() =>
      db.query("insert into public.material_versions (material_id, client_id, note) values ($1,$2,'v2')", [
        m.materialId,
        IDS.clienteA,
      ]),
    );
    expect(erro).toMatch(/solicitação de aprovação aberta/);
  });
});

describe("solicitações de aprovação", () => {
  it("só aceita a versão mais recente e exige arquivos", async () => {
    const m = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA });
    // v2 sem arquivos
    await db.query("insert into public.material_versions (material_id, client_id, note) values ($1,$2,'v2')", [
      m.materialId,
      IDS.clienteA,
    ]);
    const { rows } = await db.query<{ id: string; number: number }>(
      "select id, number from public.material_versions where material_id=$1 order by number",
      [m.materialId],
    );
    const request = (versionId: string) =>
      errorOf(() =>
        db.query(
          "insert into public.approval_requests (material_id, version_id, client_id) values ($1,$2,$3)",
          [m.materialId, versionId, IDS.clienteA],
        ),
      );
    expect(await request(rows[0].id)).toMatch(/mais recente/);
    expect(await request(rows[1].id)).toMatch(/não possui arquivos/);
  });

  it("move o material para 'aguardando' e permite só uma solicitação aberta por versão", async () => {
    const m = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA, sent: true });
    const { rows } = await db.query<{ status: string }>("select status from public.materials where id=$1", [m.materialId]);
    expect(rows[0].status).toBe("aguardando");
    const erro = await errorOf(() =>
      db.query("insert into public.approval_requests (material_id, version_id, client_id) values ($1,$2,$3)", [
        m.materialId,
        m.versionId,
        IDS.clienteA,
      ]),
    );
    expect(erro).toMatch(/unique|duplicate/i);
  });
});

describe("aprovadores e perfis", () => {
  it("só vincula login com papel 'cliente'", async () => {
    const erro = await errorOf(() =>
      db.query(
        "insert into public.approvers (client_id, profile_id, name, email) values ($1,$2,'Equipe','equipe@x.test')",
        [IDS.clienteA, IDS.designer],
      ),
    );
    expect(erro).toMatch(/papel "cliente"/);
  });

  it("não vincula perfil de outra organização", async () => {
    const outro = uid(90);
    await db.query("insert into auth.users (id, email) values ($1,'x@outra.test')", [outro]);
    await db.query(
      "insert into public.profiles (id, organization_id, full_name, email, role) values ($1,$2,'Cliente Outra Org','x@outra.test','cliente')",
      [outro, IDS.orgOutra],
    );
    const erro = await errorOf(() =>
      db.query("insert into public.approvers (client_id, profile_id, name, email) values ($1,$2,'X Y','y@x.test')", [
        IDS.clienteA,
        outro,
      ]),
    );
    expect(erro).toMatch(/mesma organização/);
  });

  it("normaliza o e-mail: exige minúsculas", async () => {
    const erro = await errorOf(() =>
      db.query("insert into public.approvers (client_id, name, email) values ($1,'Fulano','Fulano@X.test')", [IDS.clienteA]),
    );
    expect(erro).toMatch(/check/i);
  });
});

describe("imutabilidade e auditoria", () => {
  it("registra auditoria ao criar versão, arquivo e solicitação", async () => {
    const m = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA, sent: true });
    const { rows } = await db.query<{ action: string }>(
      "select action from public.audit_events where metadata->>'material_id' = $1 order by id",
      [m.materialId],
    );
    expect(rows.map((r) => r.action)).toEqual([
      "version.created",
      "file.added",
      "approval_request.created",
    ]);
  });

  it("audit_events não aceita update, delete nem truncate", async () => {
    expect(await errorOf(() => db.query("update public.audit_events set action='x_x'"))).toMatch(/imutável/);
    expect(await errorOf(() => db.query("delete from public.audit_events"))).toMatch(/imutável/);
    expect(await errorOf(() => db.exec("truncate public.audit_events"))).toMatch(/imutável/);
  });
});
