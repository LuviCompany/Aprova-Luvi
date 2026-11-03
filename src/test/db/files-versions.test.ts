// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRESENTED_FIELDS } from "@/lib/materials/schema";
import { IDS, createMaterial, createTestDb, errorOf, seedBase, type TestDb } from "./harness";

/**
 * Módulo 3, etapas C e D (migrations C1 e C2): regras dos arquivos, ordenação de slides, conteúdo
 * congelado por versão e operação explícita de revisão, tudo NO BANCO.
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

type Type = "imagem" | "carrossel" | "video" | "pdf";
const MIME = { imagem: "image/jpeg", video: "video/mp4", pdf: "application/pdf" } as const;

/** Material (rascunho) + versão 1 sem arquivos, como superusuário. */
async function newMaterial(type: Type, extra: { clientId?: string; projectId?: string; caption?: string } = {}) {
  const clientId = extra.clientId ?? IDS.clienteA;
  const materialId = randomUUID();
  const versionId = randomUUID();
  await db.query(
    "insert into public.materials (id, project_id, client_id, title, type, caption, created_by) values ($1,$2,$3,'Material de teste',$4,$5,$6)",
    [materialId, extra.projectId ?? IDS.projetoA, clientId, type, extra.caption ?? "", IDS.designer],
  );
  await db.query("insert into public.material_versions (id, material_id, client_id, note, created_by) values ($1,$2,$3,'v1',$4)", [
    versionId,
    materialId,
    clientId,
    IDS.designer,
  ]);
  return { materialId, versionId, clientId };
}

interface FileOpts {
  position?: number;
  kind?: "imagem" | "video" | "pdf";
  path?: string;
  versionId?: string;
}
const fileSql = `insert into public.material_files (version_id, material_id, client_id, slide_position, kind, storage_path,
  original_name, mime_type, size_bytes, created_by) values ($1,$2,$3,$4,$5,$6,'arquivo.bin',$7,1000,$8) returning id`;
async function addFile(m: { materialId: string; versionId: string; clientId: string }, o: FileOpts = {}, as: string | null = null) {
  const kind = o.kind ?? "imagem";
  const params = [
    o.versionId ?? m.versionId,
    m.materialId,
    m.clientId,
    o.position ?? 1,
    kind,
    o.path ?? `${m.clientId}/${m.materialId}/${randomUUID()}.bin`,
    MIME[kind],
    as ?? IDS.designer,
  ];
  let id = "";
  const run = async () => {
    try {
      id = (await db.query<{ id: string }>(fileSql, params)).rows[0].id;
      return null;
    } catch (error) {
      return (error as Error).message;
    }
  };
  const error = as ? await db.asUser(as, run) : await run();
  return { id, error };
}
const slides = async (versionId: string) =>
  (await q<{ id: string; slide_position: number }>("select id, slide_position from public.material_files where version_id = $1 order by slide_position", [versionId]));

describe("regras dos arquivos por tipo de material", () => {
  it("imagem, vídeo e PDF têm UM arquivo do próprio tipo, na posição 1", async () => {
    for (const type of ["imagem", "video", "pdf"] as const) {
      const m = await newMaterial(type);
      expect((await addFile(m, { kind: type, position: 2 })).error, `${type} pos 2`).toMatch(/incompatível/);
      for (const other of (["imagem", "video", "pdf"] as const).filter((k) => k !== type)) {
        expect((await addFile(m, { kind: other })).error, `${type} com ${other}`).toMatch(/incompatível/);
      }
      expect((await addFile(m, { kind: type })).error, type).toBeNull();
      expect((await addFile(m, { kind: type })).error, `${type} segundo arquivo`).toMatch(/duplicate key|unique/);
    }
  });

  it("carrossel: de 1 a 10 slides, imagem ou vídeo (misturados); PDF e a posição 11 são recusados", async () => {
    const m = await newMaterial("carrossel");
    for (let i = 1; i <= 10; i++) {
      expect((await addFile(m, { position: i, kind: i % 3 === 0 ? "video" : "imagem" })).error, `slide ${i}`).toBeNull();
    }
    expect((await addFile(m, { position: 11 })).error).toMatch(/incompatível/);
    expect((await addFile(m, { position: 0 })).error).toMatch(/check/i);
    const m2 = await newMaterial("carrossel");
    expect((await addFile(m2, { kind: "pdf" })).error).toMatch(/incompatível/);
  });

  it("o caminho precisa ficar na pasta {cliente}/{material}/ do próprio material", async () => {
    const m = await newMaterial("imagem");
    const other = await newMaterial("imagem");
    expect((await addFile(m, { path: `${m.clientId}/${other.materialId}/x.bin` })).error).toMatch(/fora da pasta do material/);
    expect((await addFile(m, { path: `${m.clientId}/solto.bin` })).error).toMatch(/fora da pasta do material/);
    expect((await addFile(m, { path: `${IDS.clienteB}/${m.materialId}/x.bin` })).error).toMatch(/check|fora da pasta/i);
    expect((await addFile(m, { path: `${m.clientId}/${m.materialId}/ok.bin` })).error).toBeNull();
  });

  it("só a versão mais recente aceita arquivos", async () => {
    const m = await newMaterial("imagem");
    const v2 = randomUUID();
    await db.query("insert into public.material_versions (id, material_id, client_id, note, created_by) values ($1,$2,$3,'v2',$4)", [v2, m.materialId, m.clientId, IDS.designer]);
    expect((await addFile(m, { versionId: m.versionId })).error).toMatch(/só a versão mais recente/);
    expect((await addFile(m, { versionId: v2 })).error).toBeNull();
  });

  it("material fora de rascunho não troca arquivos (nem pelo servidor); a equipe comum depende da RLS", async () => {
    for (const status of ["aguardando", "alteracao", "aprovado"]) {
      const m = await newMaterial("imagem");
      await db.query("update public.materials set status = $2 where id = $1", [m.materialId, status]);
      expect((await addFile(m)).error, status).toMatch(/fora de rascunho/);
    }
    const sent = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA, sent: true });
    const err = await db.asUser(IDS.designer, () =>
      errorOf(() =>
        db.query(fileSql, [sent.versionId, sent.materialId, IDS.clienteA, 2, "imagem", `${IDS.clienteA}/${sent.materialId}/n.bin`, "image/jpeg", IDS.designer]),
      ),
    );
    expect(err).toMatch(/row-level security/);
  });

  it("a equipe cadastra pelo app; aprovador e outra organização não", async () => {
    const m = await newMaterial("carrossel");
    expect((await addFile(m, { position: 1 }, IDS.designer)).error).toBeNull();
    expect((await addFile(m, { position: 2 }, IDS.atendimento)).error).toBeNull();
    expect((await addFile(m, { position: 3 }, IDS.userClienteA)).error).toMatch(/row-level security/);
    expect((await addFile(m, { position: 3 }, IDS.staffOutraOrg)).error).toMatch(/row-level security/);
  });
});

describe("reordenação de slides", () => {
  const reorder = (user: string, versionId: string, order: string[]) =>
    db.asUser(user, () => errorOf(() => db.query("select public.reorder_version_files($1, $2)", [versionId, order])));

  async function carousel(n: number) {
    const m = await newMaterial("carrossel");
    const ids: string[] = [];
    for (let i = 1; i <= n; i++) ids.push((await addFile(m, { position: i })).id);
    return { ...m, ids };
  }

  it("aplica a nova ordem de forma atômica e deixa posições 1..n", async () => {
    const c = await carousel(4);
    const order = [c.ids[3], c.ids[0], c.ids[2], c.ids[1]];
    expect(await reorder(IDS.designer, c.versionId, order)).toBeNull();
    expect((await slides(c.versionId)).map((s) => s.id)).toEqual(order);
    expect((await slides(c.versionId)).map((s) => s.slide_position)).toEqual([1, 2, 3, 4]);
  });

  it("recusa lista incompleta, repetida ou com arquivo de outra versão, sem alterar nada", async () => {
    const c = await carousel(3);
    const other = await carousel(2);
    const before = (await slides(c.versionId)).map((s) => s.id);
    for (const bad of [[c.ids[0], c.ids[1]], [c.ids[0], c.ids[0], c.ids[1]], [c.ids[0], c.ids[1], other.ids[0]], []]) {
      expect(await reorder(IDS.designer, c.versionId, bad)).toMatch(/todos os arquivos/);
    }
    expect((await slides(c.versionId)).map((s) => s.id)).toEqual(before);
  });

  it("só a equipe com acesso ao cliente reordena", async () => {
    const c = await carousel(2);
    for (const user of [IDS.userClienteA, IDS.staffOutraOrg]) {
      expect(await reorder(user, c.versionId, [c.ids[1], c.ids[0]]), user).toMatch(/sem permissão/);
    }
    expect(await db.asAnon(() => errorOf(() => db.query("select public.reorder_version_files($1, $2)", [c.versionId, c.ids])))).toMatch(/permission denied/);
    expect(await db.asService(() => errorOf(() => db.query("select public.reorder_version_files($1, $2)", [c.versionId, c.ids])))).toMatch(/sem permissão/);
  });

  it("versão enviada ou que não é a mais recente não muda de ordem", async () => {
    const sent = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA, sent: true });
    const [file] = await slides(sent.versionId);
    expect(await reorder(IDS.designer, sent.versionId, [file.id])).toMatch(/já enviada/);
    const c = await carousel(2);
    await db.query("insert into public.material_versions (material_id, client_id, note, created_by) values ($1,$2,'v2',$3)", [c.materialId, c.clientId, IDS.designer]);
    expect(await reorder(IDS.designer, c.versionId, [c.ids[1], c.ids[0]])).toMatch(/mais recente/);
  });
});

describe("conteúdo congelado por versão", () => {
  const contentOf = async (versionId: string) =>
    (await q<{ content: Record<string, unknown> }>("select content from public.material_version_contents where version_id = $1", [versionId]))[0]?.content;

  it("ao criar a solicitação de aprovação, congela o que o cliente vê: campos apresentados + arquivos", async () => {
    const m = await newMaterial("imagem", { caption: "Legenda enviada" });
    await addFile(m);
    expect(await contentOf(m.versionId)).toBeUndefined(); // rascunho: ainda não congelado
    await db.query("update public.materials set channel = 'Instagram Feed', aspect_ratio = '4:5', publish_date = '2026-12-01', due_date = '2026-11-20' where id = $1", [m.materialId]);
    await db.query("insert into public.approval_requests (material_id, version_id, client_id, requested_by) values ($1,$2,$3,$4)", [m.materialId, m.versionId, m.clientId, IDS.designer]);
    const content = (await contentOf(m.versionId))!;
    expect(Object.keys(content).sort()).toEqual([...PRESENTED_FIELDS, "files"].sort());
    expect(content).toMatchObject({
      title: "Material de teste",
      caption: "Legenda enviada",
      type: "imagem",
      aspect_ratio: "4:5",
      channel: "Instagram Feed",
      publish_date: "2026-12-01",
      due_date: "2026-11-20",
    });
    expect(content.files).toEqual([
      expect.objectContaining({ position: 1, kind: "imagem", mime_type: "image/jpeg", original_name: "arquivo.bin", size_bytes: 1000 }),
    ]);
    expect(JSON.stringify(content)).not.toContain(m.materialId); // sem ids nem caminhos do storage
  });

  it("o material pode ser reagendado depois, mas a cópia da versão enviada não muda", async () => {
    const m = await newMaterial("imagem", { caption: "Original" });
    await addFile(m);
    await db.query("insert into public.approval_requests (material_id, version_id, client_id, requested_by) values ($1,$2,$3,$4)", [m.materialId, m.versionId, m.clientId, IDS.designer]);
    const before = await contentOf(m.versionId);
    await db.asUser(IDS.designer, () => db.query("update public.materials set publish_date = '2027-01-10' where id = $1", [m.materialId]));
    expect(await contentOf(m.versionId)).toEqual(before);
  });

  it("é imutável (até para o dono do banco) e o app só lê", async () => {
    const m = await newMaterial("imagem");
    await addFile(m);
    await db.query("insert into public.approval_requests (material_id, version_id, client_id, requested_by) values ($1,$2,$3,$4)", [m.materialId, m.versionId, m.clientId, IDS.designer]);
    expect(await errorOf(() => db.query("update public.material_version_contents set content = '{}' where version_id = $1", [m.versionId]))).toMatch(/imutável/);
    expect(await errorOf(() => db.query("delete from public.material_version_contents where version_id = $1", [m.versionId]))).toMatch(/imutável/);
    expect(await errorOf(() => db.exec("truncate public.material_version_contents"))).toMatch(/imutável/);
    for (const sql of [
      `insert into public.material_version_contents (version_id, material_id, client_id, content) values ('${m.versionId}','${m.materialId}','${m.clientId}','{}')`,
      "update public.material_version_contents set content = '{}'",
      "delete from public.material_version_contents",
    ]) {
      for (const run of [(f: () => Promise<string | null>) => db.asUser(IDS.admin, f), (f: () => Promise<string | null>) => db.asAnon(f)]) {
        expect(await run(() => errorOf(() => db.query(sql))), sql).toMatch(/permission denied/);
      }
    }
  });

  it("RLS: a equipe lê; o aprovador só lê versão ENVIADA do próprio cliente; anônimo nada", async () => {
    const sent = await newMaterial("imagem");
    await addFile(sent);
    await db.query("insert into public.approval_requests (material_id, version_id, client_id, requested_by) values ($1,$2,$3,$4)", [sent.materialId, sent.versionId, sent.clientId, IDS.designer]);
    const draft = await newMaterial("imagem");
    await db.query("select app.freeze_version_content($1)", [draft.versionId]); // congelada sem envio (ex.: rascunho substituído)
    const count = (user: string, id: string) =>
      db.asUser(user, async () => (await db.query("select 1 from public.material_version_contents where version_id = $1", [id])).rows.length);
    expect(await count(IDS.designer, sent.versionId)).toBe(1);
    expect(await count(IDS.staffOutraOrg, sent.versionId)).toBe(0);
    expect(await count(IDS.userClienteA, sent.versionId)).toBe(1);
    expect(await count(IDS.userClienteB, sent.versionId)).toBe(0); // outro cliente
    expect(await count(IDS.userClienteA, draft.versionId)).toBe(0); // não enviada
    expect(await db.asAnon(() => errorOf(() => db.query("select 1 from public.material_version_contents")))).toMatch(/permission denied/);
  });

  it("criar a versão seguinte congela a anterior (conteúdo daquele momento), sem tocar na nova", async () => {
    const m = await newMaterial("imagem", { caption: "Primeira" });
    await db.query("update public.materials set caption = 'Primeira, ajustada' where id = $1", [m.materialId]);
    const v2 = (await q<{ id: string }>("insert into public.material_versions (material_id, client_id, note, created_by) values ($1,$2,'v2',$3) returning id", [m.materialId, m.clientId, IDS.designer]))[0].id;
    expect(await contentOf(m.versionId)).toMatchObject({ caption: "Primeira, ajustada" });
    expect(await contentOf(v2)).toBeUndefined();
    await db.query("update public.materials set caption = 'Segunda' where id = $1", [m.materialId]);
    expect(await contentOf(m.versionId)).toMatchObject({ caption: "Primeira, ajustada" });
  });

  it("as funções de congelamento não são executáveis pela API", async () => {
    for (const fn of ["app.freeze_version_content(uuid)", "app.requests_freeze_content()", "app.material_files_validate()"]) {
      for (const role of ["anon", "authenticated", "service_role"]) {
        const [row] = await q<{ ok: boolean }>(`select has_function_privilege('${role}', '${fn}', 'EXECUTE') as ok`);
        expect(row.ok, `${role} ${fn}`).toBe(false);
      }
    }
  });
});

describe("operação explícita de revisão (start_material_revision)", () => {
  const start = (user: string, materialId: string, reason = "Ajustar o logo e o preço do slide 3") =>
    db.asUser(user, () => errorOf(() => db.query("select public.start_material_revision($1, $2)", [materialId, reason])));
  const statusOf = async (id: string) => (await q<{ status: string }>("select status from public.materials where id = $1", [id]))[0].status;

  async function approvedForReal() {
    const m = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA, sent: true });
    await db.asUser(IDS.userClienteA, () => db.query("select public.decide_as_approver($1,'aprovado','')", [m.requestId]));
    return m;
  }
  const history = async (id: string) => ({
    decisions: await q("select to_jsonb(d) as r from public.decisions d where material_id = $1", [id]),
    requests: await q("select to_jsonb(r) as r from public.approval_requests r where material_id = $1", [id]),
    v1: await q("select to_jsonb(v) as r from public.material_versions v where material_id = $1 and number = 1", [id]),
    files: await q("select to_jsonb(f) as r from public.material_files f where material_id = $1", [id]),
    content: await q("select to_jsonb(c) as r from public.material_version_contents c where material_id = $1 and version_id in (select id from public.material_versions where number = 1 and material_id = $1)", [id]),
  });

  it("material aprovado: cria a v2 com o motivo na nota, volta a rascunho, consome o tíquete e preserva todo o histórico", async () => {
    const m = await approvedForReal();
    expect(await statusOf(m.materialId)).toBe("aprovado");
    const before = await history(m.materialId);
    expect(before.content).toHaveLength(1); // congelado no envio
    expect(await start(IDS.designer, m.materialId)).toBeNull();
    expect(await statusOf(m.materialId)).toBe("rascunho");
    const versions = await q<{ number: number; note: string }>("select number, note from public.material_versions where material_id = $1 order by number", [m.materialId]);
    expect(versions).toEqual([expect.objectContaining({ number: 1 }), { number: 2, note: "Ajustar o logo e o preço do slide 3" }]);
    expect(await q("select 1 from app.revision_tickets")).toHaveLength(0);
    expect(await history(m.materialId)).toEqual(before);
    // E a v2 ainda aceita arquivos novos, enquanto a v1 não.
    const [v2] = await q<{ id: string }>("select id from public.material_versions where material_id = $1 and number = 2", [m.materialId]);
    expect((await addFile({ ...m, clientId: IDS.clienteA }, { versionId: v2.id, position: 1 })).error).toBeNull();
    expect((await addFile({ ...m, clientId: IDS.clienteA }, { versionId: m.versionId, position: 2 })).error).toMatch(/só a versão mais recente/);
  });

  it("alteração pedida também entra em revisão; rascunho, enviado e aprovado-sem-motivo não", async () => {
    const alt = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA, sent: true });
    await db.asUser(IDS.userClienteA, () => db.query("select public.decide_as_approver($1,'alteracao','Trocar a foto principal por outra')", [alt.requestId]));
    expect(await statusOf(alt.materialId)).toBe("alteracao");
    expect(await start(IDS.atendimento, alt.materialId)).toBeNull();
    expect(await statusOf(alt.materialId)).toBe("rascunho");

    expect(await start(IDS.designer, alt.materialId)).toMatch(/aprovado ou com alteração/); // agora é rascunho
    const waiting = await createMaterial(db, { clientId: IDS.clienteA, projectId: IDS.projetoA, sent: true });
    expect(await start(IDS.designer, waiting.materialId)).toMatch(/aprovado ou com alteração/);

    const ok = await approvedForReal();
    for (const reason of ["", "curto", " ".repeat(20), "x".repeat(501)]) {
      expect(await start(IDS.designer, ok.materialId, reason), reason.slice(0, 5)).toMatch(/motivo da revisão/);
    }
    expect(await statusOf(ok.materialId)).toBe("aprovado");
  });

  it("aprovador, equipe de outra organização, anônimo e servidor sem usuário não iniciam revisão", async () => {
    const m = await approvedForReal();
    expect(await start(IDS.userClienteA, m.materialId)).toMatch(/sem permissão/);
    expect(await start(IDS.staffOutraOrg, m.materialId)).toMatch(/sem permissão/);
    expect(await db.asAnon(() => errorOf(() => db.query("select public.start_material_revision($1, 'um motivo válido aqui')", [m.materialId])))).toMatch(/permission denied/);
    expect(await db.asService(() => errorOf(() => db.query("select public.start_material_revision($1, 'um motivo válido aqui')", [m.materialId])))).toMatch(/sem permissão/);
    expect(await statusOf(m.materialId)).toBe("aprovado");
  });

  it("não há atalho: material aprovado continua recusando versão e status por fora da operação", async () => {
    const m = await approvedForReal();
    const direct = await db.asUser(IDS.designer, () =>
      errorOf(() => db.query("insert into public.material_versions (material_id, client_id, note, created_by) values ($1,$2,'x',$3)", [m.materialId, IDS.clienteA, IDS.designer])),
    );
    expect(direct).toMatch(/operação de revisão/);
    expect(await db.asService(() => errorOf(() => db.query("update public.materials set status = 'rascunho' where id = $1", [m.materialId])))).toMatch(/operação de revisão/);
  });

  it("a auditoria registra a revisão sem o texto do motivo", async () => {
    const m = await approvedForReal();
    const reason = "Motivo-confidencial-xyz do cliente";
    expect(await start(IDS.designer, m.materialId, reason)).toBeNull();
    const events = await q<{ action: string; actor_profile_id: string; metadata: Record<string, unknown> }>(
      "select action, actor_profile_id, metadata from public.audit_events where entity_id = $1 and action = 'material.revision_started'",
      [m.materialId],
    );
    expect(events).toHaveLength(1);
    expect(events[0].actor_profile_id).toBe(IDS.designer);
    expect(events[0].metadata).toEqual({ client_id: IDS.clienteA, actor_role: "designer", status_from: "aprovado", status_to: "rascunho" });
    expect(JSON.stringify(events[0].metadata)).not.toContain("confidencial");
    expect(await q("select 1 from public.audit_events where action = 'version.created' and metadata->>'material_id' = $1", [m.materialId])).toHaveLength(2);
  });
});
