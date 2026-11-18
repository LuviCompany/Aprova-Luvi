// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedBase, type TestDb } from "./harness";
import { buildVerifySummary, parseChecks } from "../../../scripts/build-verify-summary.mjs";

/**
 * supabase/verify-summary.sql é o que se roda no projeto real (uma tabela com uma linha por bloco do
 * verify.sql). Precisa estar em dia com o verify.sql e dar 0 em todas as linhas no esquema testado.
 */

let db: TestDb;
const verifySql = readFileSync(join(process.cwd(), "supabase", "verify.sql"), "utf8");
const summarySql = readFileSync(join(process.cwd(), "supabase", "verify-summary.sql"), "utf8").replace(/\r\n/g, "\n");

beforeAll(async () => {
  db = await createTestDb();
  await seedBase(db);
}, 180_000);

afterAll(async () => {
  await db.close();
});

describe("supabase/verify-summary.sql", () => {
  it("está em dia com o verify.sql (rode node scripts/build-verify-summary.mjs se falhar)", () => {
    expect(summarySql).toBe(buildVerifySummary(verifySql));
  });

  it("devolve uma linha por bloco e todas com 0 violações", async () => {
    const blocks = parseChecks(verifySql).length;
    expect(blocks).toBe(31);
    const { rows } = await db.query<{ bloco: number; verificacao: string; violacoes: number | string }>(summarySql.replace(/;\s*$/, ""));
    expect(rows).toHaveLength(blocks);
    expect(rows.map((r) => Number(r.bloco))).toEqual(Array.from({ length: blocks }, (_, i) => i + 1));
    for (const r of rows) expect(Number(r.violacoes), r.verificacao).toBe(0);
  });

  it("DETECTA uma violação (a versão resumida não é decorativa)", async () => {
    await db.exec("grant select on public.approval_links to anon");
    try {
      const { rows } = await db.query<{ violacoes: number | string }>(summarySql.replace(/;\s*$/, ""));
      expect(rows.some((r) => Number(r.violacoes) > 0)).toBe(true);
    } finally {
      await db.exec("revoke all on public.approval_links from anon");
    }
  });
});
