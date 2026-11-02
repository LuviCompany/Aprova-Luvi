// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDS, createMaterial, createTestDb, seedBase, type TestDb } from "./harness";

/**
 * Valida supabase/preflight.sql: num banco "vazio" (só o que o Supabase fornece) nenhum CHECK
 * pode acusar nada, e depois de aplicadas as migrations os CHECKs precisam acusar (provando que
 * o pré-voo detecta um projeto que já tem conteúdo).
 */

const sql = readFileSync(join(process.cwd(), "supabase", "preflight.sql"), "utf8");
const blocks = sql
  .split(/^-- (?=SUMMARY:|CHECK:|INFO:)/m)
  .slice(1)
  .map((block) => {
    const [head, ...rest] = block.split("\n");
    const kind = head.startsWith("SUMMARY:") ? "summary" : head.startsWith("CHECK:") ? "check" : "info";
    return { kind, title: head.replace(/^(CHECK|INFO):\s*/, "").trim(), query: rest.join("\n").replace(/^--.*$/gm, "").trim().replace(/;\s*$/, "") };
  });
const summary = blocks.find((b) => b.kind === "summary")!;
const checks = blocks.filter((b) => b.kind === "check");
const infos = blocks.filter((b) => b.kind === "info");

let empty: TestDb;
let populated: TestDb;

beforeAll(async () => {
  empty = await createTestDb({ migrate: false });
  populated = await createTestDb();
  await seedBase(populated);
  await createMaterial(populated, { clientId: IDS.clienteA, projectId: IDS.projetoA }); // cria também um arquivo no Storage
}, 60_000);

afterAll(async () => {
  await empty.close();
  await populated.close();
});

describe("supabase/preflight.sql", () => {
  it("tem os blocos esperados", () => {
    expect(summary).toBeDefined();
    expect(checks.length).toBeGreaterThanOrEqual(7);
    expect(infos.length).toBeGreaterThanOrEqual(3);
  });

  for (const c of checks) {
    it(`banco vazio passa: ${c.title}`, async () => {
      expect((await empty.query(c.query)).rows).toEqual([]);
    });
  }

  for (const i of infos) {
    it(`bloco informativo executa sem erro: ${i.title}`, async () => {
      await expect(empty.query(i.query)).resolves.toBeDefined();
    });
  }

  it("ACUSA um projeto que já tem objetos, schema app, usuários, buckets e arquivos", async () => {
    const byTitle = (start: string) => checks.find((c) => c.title.startsWith(start))!;
    for (const start of [
      "objetos de usuário já existentes",
      "schema \"app\" já existe",
      "usuários já cadastrados",
      "buckets do Storage",
      "arquivos já existentes",
      "políticas já existentes em storage.objects",
    ]) {
      const rows = (await populated.query(byTitle(start).query)).rows;
      expect(rows.length, start).toBeGreaterThan(0);
    }
  });

  it("o SUMMARY devolve UM resultado só, com uma linha por verificação, e zera num banco vazio", async () => {
    expect(summary).toBeDefined();
    const rows = (await empty.query<{ verificacao: string; violacoes: string | number }>(summary.query)).rows;
    expect(rows).toHaveLength(7);
    expect(rows.map((r) => Number(r.violacoes))).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("o SUMMARY acusa objetos, schema app, usuários, buckets, arquivos e políticas num projeto com conteúdo", async () => {
    const rows = (await populated.query<{ verificacao: string; violacoes: string | number }>(summary.query)).rows;
    const counts = rows.map((r) => Number(r.violacoes));
    // 1..6 acusam; a 7ª (Realtime) continua 0 porque a base de teste não publica nada.
    expect(counts.slice(0, 6).every((n) => n > 0)).toBe(true);
    expect(counts[6]).toBe(0);
  });

  it("detecta um único objeto solto no schema public", async () => {
    const db = await createTestDb({ migrate: false });
    try {
      await db.exec("create table public.alguma_coisa (id int)");
      const rows = (await db.query(checks[0].query)).rows as Array<{ nome: string }>;
      expect(rows.map((r) => r.nome)).toEqual(["public.alguma_coisa"]);
    } finally {
      await db.close();
    }
  });
});
