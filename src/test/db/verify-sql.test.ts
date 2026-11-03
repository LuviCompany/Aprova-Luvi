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

  it("DETECTA tíquete de revisão exposto à API ou função interna executável (blocos do schema app)", async () => {
    const table = checks.find((c) => c.title.startsWith("tabelas do schema app acessíveis"))!;
    const functions = checks.find((c) => c.title.startsWith("funções internas de tíquete"))!;
    await db.exec("grant select on app.revision_tickets to authenticated");
    try {
      expect((await db.query(table.query)).rows).toEqual([{ tabela: "revision_tickets" }]);
    } finally {
      await db.exec("revoke all on app.revision_tickets from authenticated");
    }
    await db.exec("alter table app.revision_tickets disable row level security");
    try {
      expect((await db.query(table.query)).rows).toEqual([{ tabela: "revision_tickets" }]);
    } finally {
      await db.exec("alter table app.revision_tickets enable row level security");
    }
    await db.exec("grant execute on function app.grant_revision_ticket(uuid) to service_role");
    try {
      expect((await db.query(functions.query)).rows).toEqual([{ funcao: "grant_revision_ticket", papel: "service_role" }]);
    } finally {
      await db.exec("revoke execute on function app.grant_revision_ticket(uuid) from service_role");
    }
  });

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
