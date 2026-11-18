// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { installAutoRls } from "./auto-rls";
import { createTestDb, type TestDb } from "./harness";
// Usados abaixo para a verificação resumida do banco inteiro.
import { buildVerifySummary } from "../../../scripts/build-verify-summary.mjs";

/**
 * Incidente em produção: a migration 08 (20261103120300) falhou com 42723 "function audit_row_change already
 * exists with same argument types". Estes testes fixam o que se sabe: só a 08 cria app.audit_row_change() (a 10
 * usa CREATE OR REPLACE); reexecutar a 08 falha no PRIMEIRO comando e não muda nada; o diagnóstico somente
 * leitura (supabase/diagnostico-migration-08.sql) distingue "não aplicada", "já aplicada" e "parcial"; e a
 * sequência completa funciona num banco com o RLS automático do Supabase.
 */

// Cada teste sobe um banco em memória e aplica migrations: com a suíte inteira rodando em paralelo, 20 s não bastam.
vi.setConfig({ testTimeout: 120_000 });

const dir = join(process.cwd(), "supabase");
const files = readdirSync(join(dir, "migrations")).filter((f) => f.endsWith(".sql")).sort();
const M08 = files.indexOf("20261103120300_audit_clients_projects_approvers.sql");
const M10 = files.indexOf("20261104120100_audit_materials.sql");
const read = (i: number) => readFileSync(join(dir, "migrations", files[i]), "utf8");
const diagnosticSql = readFileSync(join(dir, "diagnostico-migration-08.sql"), "utf8");
const diagnosticQuery = diagnosticSql.replace(/^--.*$/gm, "").trim().replace(/;\s*$/, "");

async function fresh(opts: { autoRls?: boolean; upTo?: number } = {}) {
  const db = await createTestDb({ migrate: false });
  if (opts.autoRls) await installAutoRls(db);
  for (let i = 0; i <= (opts.upTo ?? -1); i++) await db.exec(read(i));
  return db;
}

async function verdict(db: TestDb) {
  const { rows } = await db.query<{ item: string; esperado: string; encontrado: string; situacao: string }>(diagnosticQuery);
  return { rows, verdict: rows.find((r) => r.item === "VEREDITO")!.encontrado };
}

/** Foto do estado relevante, para provar que uma execução que falhou não mudou nada. */
async function snapshot(db: TestDb) {
  const fn = await db.query("select md5(prosrc) as m, prosecdef, proconfig::text as c, proacl::text as acl from pg_proc where proname = 'audit_row_change' and pronamespace = 'app'::regnamespace");
  const trg = await db.query("select tgname from pg_trigger where tgname like '%audit_row' and not tgisinternal order by 1");
  const audit = await db.query("select count(*)::int as n from public.audit_events");
  return JSON.stringify([fn.rows, trg.rows, audit.rows]);
}

describe("migration 08: causa do erro 42723", () => {
  it("só a migration 08 CRIA app.audit_row_change(); a 10 usa CREATE OR REPLACE; as outras não a tocam", () => {
    const creators = files.filter((_, i) => /^create function app\.audit_row_change\(\)/m.test(read(i)));
    expect(creators).toEqual(["20261103120300_audit_clients_projects_approvers.sql"]);
    expect(read(M10)).toMatch(/^create or replace function app\.audit_row_change\(\)/m);
    // O comando que falha é o PRIMEIRO da migration 08 (nada vem antes dele além de comentários).
    const firstStatement = read(M08).replace(/^--.*$/gm, "").trim().split(/\n/)[0];
    expect(firstStatement).toBe("create function app.audit_row_change() returns trigger");
  });

  it("a função existe depois da 08 e não existe antes dela", async () => {
    const before = await fresh({ upTo: M08 - 1 });
    const after = await fresh({ upTo: M08 });
    try {
      const q = "select count(*)::int as n from pg_proc where proname = 'audit_row_change' and pronamespace = 'app'::regnamespace";
      expect((await before.query<{ n: number }>(q)).rows[0].n).toBe(0);
      expect((await after.query<{ n: number }>(q)).rows[0].n).toBe(1);
    } finally {
      await before.close();
      await after.close();
    }
  });

  it("REEXECUTAR a 08 reproduz o erro 42723 e não altera nada (a falha é no primeiro comando)", async () => {
    const db = await fresh({ upTo: M08, autoRls: true });
    try {
      const before = await snapshot(db);
      await expect(db.exec(read(M08))).rejects.toMatchObject({
        code: "42723",
        message: expect.stringMatching(/function "audit_row_change" already exists with same argument types/),
      });
      expect(await snapshot(db)).toBe(before);
      expect((await verdict(db)).verdict).toMatch(/^B\)/);
    } finally {
      await db.close();
    }
  });
});

describe("supabase/diagnostico-migration-08.sql", () => {
  it("é somente leitura (nenhum comando de escrita fora dos comentários)", () => {
    expect(diagnosticQuery).not.toMatch(/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum)\b/i);
    expect(diagnosticQuery).toMatch(/^with /i);
  });

  it("antes da 08: veredito A (não aplicada, pode executar)", async () => {
    const db = await fresh({ upTo: M08 - 1, autoRls: true });
    try {
      const { rows, verdict: v } = await verdict(db);
      expect(v).toMatch(/^A\)/);
      expect(rows.find((r) => r.item.startsWith("dependências"))).toMatchObject({ encontrado: "6 de 6", situacao: "ok" });
      expect(rows.find((r) => r.item.startsWith("triggers"))!.encontrado).toBe("0 de 4");
    } finally {
      await db.close();
    }
  });

  it("depois da 08: veredito B (já aplicada por completo, NÃO reexecutar); corpo igual ao da 08", async () => {
    const db = await fresh({ upTo: M08, autoRls: true });
    try {
      const { rows, verdict: v } = await verdict(db);
      expect(v).toMatch(/^B\)/);
      expect(rows.find((r) => r.item === "corpo da função")!.encontrado).toBe("igual à migration 08");
      expect(rows.find((r) => r.item.startsWith("SECURITY DEFINER"))!.encontrado).toBe("sim");
      expect(rows.find((r) => r.item.startsWith("triggers"))!.encontrado).toBe("4 de 4");
    } finally {
      await db.close();
    }
  });

  it("08 parcial (um trigger faltando): veredito C; função da 10 antes da hora: veredito D", async () => {
    const partial = await fresh({ upTo: M08 });
    try {
      await partial.exec("drop trigger approvers_audit_row on public.approvers");
      expect((await verdict(partial)).verdict).toMatch(/^C\)/);
    } finally {
      await partial.close();
    }

    const early = await fresh({ upTo: M08 - 1 });
    try {
      // Simula a função da migration 10 existindo sem a 08 (corpo = o da migration 10).
      const body = read(M10).match(/as \$\$([\s\S]*?)\$\$;/)![1];
      await early.exec(`create function app.audit_row_change() returns trigger language plpgsql security definer set search_path = '' as $$${body}$$`);
      expect((await verdict(early)).verdict).toMatch(/^D\)/);
    } finally {
      await early.close();
    }
  });

  it("migrations 09 em diante já aplicadas: PARE", async () => {
    const db = await fresh({ upTo: M10 });
    try {
      expect((await verdict(db)).verdict).toMatch(/^PARE: já existem objetos das migrations 09/);
    } finally {
      await db.close();
    }
  });

  it("os md5 citados no arquivo são os dos corpos reais das migrations 08 e 10", async () => {
    const after08 = await fresh({ upTo: M08 });
    const after10 = await fresh({ upTo: M10 });
    try {
      const q = "select md5(prosrc) as m from pg_proc where proname = 'audit_row_change' and pronamespace = 'app'::regnamespace";
      const m08 = (await after08.query<{ m: string }>(q)).rows[0].m;
      const m10 = (await after10.query<{ m: string }>(q)).rows[0].m;
      expect(diagnosticSql).toContain(m08);
      expect(diagnosticSql).toContain(m10);
      expect(m08).not.toBe(m10);
    } finally {
      await after08.close();
      await after10.close();
    }
  });
});

describe("sequência completa em banco com o RLS automático do Supabase", () => {
  it("as 15 migrations aplicam, uma por vez, e o verify-summary zera (31 de 31)", async () => {
    const db = await fresh({ autoRls: true });
    try {
      for (let i = 0; i < files.length; i++) {
        await expect(db.exec(read(i)), files[i]).resolves.toBeDefined();
      }
      const summary = buildVerifySummary(readFileSync(join(dir, "verify.sql"), "utf8")).replace(/;\s*$/, "");
      const { rows } = await db.query<{ bloco: number; verificacao: string; violacoes: number | string }>(summary);
      expect(rows).toHaveLength(31);
      for (const r of rows) expect(Number(r.violacoes), r.verificacao).toBe(0);

      // o RLS automático segue instalado e válido; toda tabela do public tem RLS ligada
      const noRls = await db.query("select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity");
      expect(noRls.rows).toEqual([]);
      expect((await verdict(db)).verdict).toMatch(/^PARE: já existem objetos das migrations 09/);
    } finally {
      await db.close();
    }
  }, 120_000);

  it("com o RLS automático, tabelas criadas pelas migrations nascem com RLS ligada (antes mesmo da migration 03)", async () => {
    const db = await fresh({ autoRls: true, upTo: 0 });
    try {
      const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
        "select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'",
      );
      expect(rows.length).toBeGreaterThan(5);
      expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    } finally {
      await db.close();
    }
  });
});
