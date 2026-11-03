// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedBase, type TestDb } from "./harness";

/**
 * Roda supabase/verify.sql (o script que você executa no projeto real) contra o banco de testes.
 * Garante que o verificador funciona e que o esquema testado passa em TODOS os blocos.
 */

let db: TestDb;
const sql = readFileSync(join(process.cwd(), "supabase", "verify.sql"), "utf8");
const checks = sql
  .split(/^-- CHECK: /m)
  .slice(1)
  .map((block) => {
    const [title, ...rest] = block.split("\n");
    return { title: title.trim(), query: rest.join("\n").replace(/^--.*$/gm, "").trim().replace(/;\s*$/, "") };
  });

beforeAll(async () => {
  db = await createTestDb();
  await seedBase(db);
}, 180_000);

afterAll(async () => {
  await db.close();
});

describe("supabase/verify.sql", () => {
  it("tem os blocos esperados", () => {
    expect(checks.length).toBeGreaterThanOrEqual(15);
    for (const c of checks) expect(c.query.length, c.title).toBeGreaterThan(20);
  });

  for (const c of checks) {
    it(`sem violações: ${c.title}`, async () => {
      const { rows } = await db.query(c.query);
      expect(rows).toEqual([]);
    });
  }

  it("DETECTA uma violação real (o verificador não é decorativo)", async () => {
    await db.exec("grant select on public.approval_links to anon");
    try {
      const block = checks.find((c) => c.title.startsWith("privilégios de tabela para o papel anon"))!;
      expect((await db.query(block.query)).rows.length).toBeGreaterThan(0);
    } finally {
      await db.exec("revoke all on public.approval_links from anon");
    }
  });
});
