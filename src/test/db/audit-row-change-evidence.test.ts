// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { installAutoRls } from "./auto-rls";
import { createTestDb, type TestDb } from "./harness";

/**
 * Incidente: em produção, o diagnóstico da migration 08 disse "corpo DIFERENTE de 08 e 10" mesmo com a função, as
 * permissões e os 4 triggers corretos. Causa demonstrada aqui: o texto da migration colado no editor do navegador
 * chega com quebras CRLF; o Postgres guarda o corpo da função byte a byte, então o md5 BRUTO muda, e SEM os CR volta
 * a ser exatamente o da migration 08. O diagnóstico agora compara sem CR (falso positivo corrigido) e há uma
 * consulta de evidência somente leitura (supabase/diagnostico-audit-row-change.sql).
 */

// Cada teste sobe um banco em memória e aplica migrations: com a suíte inteira em paralelo, 20 s não bastam.
vi.setConfig({ testTimeout: 120_000 });

const dir = join(process.cwd(), "supabase");
const files = readdirSync(join(dir, "migrations")).filter((f) => f.endsWith(".sql")).sort();
const M08 = files.indexOf("20261103120300_audit_clients_projects_approvers.sql");
const read = (i: number) => readFileSync(join(dir, "migrations", files[i]), "utf8");
const query = (name: string) => readFileSync(join(dir, name), "utf8").replace(/^--.*$/gm, "").trim().replace(/;\s*$/, "");
const diagnostic08 = query("diagnostico-migration-08.sql");
const evidence = query("diagnostico-audit-row-change.sql");
const bodyQuery = query("diagnostico-audit-row-change-corpo.sql");
const EXPECTED_MD5 = "f86ee29a3a242c30d6500380cf46df2a";

/** Banco com RLS automático e as migrations 01..08, aplicando a 08 com a transformação dada. */
async function dbWith08(transform: (text: string) => string = (t) => t) {
  const db = await createTestDb({ migrate: false });
  await installAutoRls(db);
  for (let i = 0; i < M08; i++) await db.exec(read(i));
  await db.exec(transform(read(M08)));
  return db;
}

interface Row { item: string; encontrado: string; esperado: string; situacao: string }
const evidenceRows = async (db: TestDb) => (await db.query<Row>(evidence)).rows;
const evidenceVerdict = async (db: TestDb) => (await evidenceRows(db)).find((r) => r.item === "VEREDITO")!.encontrado;
const diagnosticVerdict = async (db: TestDb) =>
  (await db.query<{ item: string; encontrado: string }>(diagnostic08)).rows.find((r) => r.item === "VEREDITO")!.encontrado;

describe("causa: quebras de linha CRLF do editor mudam o md5 bruto do corpo", () => {
  it("CRLF reproduz o sintoma: função, permissões e 4 triggers certos, md5 bruto diferente, md5 sem CR = migration 08", async () => {
    const db = await dbWith08((t) => t.replace(/\n/g, "\r\n"));
    try {
      const { rows } = await db.query<{ bruto: string; sem_cr: string; n_cr: number }>(
        `select md5(prosrc) as bruto, md5(replace(prosrc, chr(13), '')) as sem_cr,
                length(prosrc) - length(replace(prosrc, chr(13), '')) as n_cr
         from pg_proc where proname = 'audit_row_change' and pronamespace = 'app'::regnamespace`,
      );
      expect(rows[0].n_cr).toBeGreaterThan(0);
      expect(rows[0].bruto).not.toBe(EXPECTED_MD5);
      expect(rows[0].sem_cr).toBe(EXPECTED_MD5);
      // o diagnóstico ANTIGO (md5 bruto) daria "E - estado inesperado": falso positivo
    } finally {
      await db.close();
    }
  });

  it("o diagnóstico da 08 passa a dizer B (já aplicada) também com CRLF, e descreve o que viu", async () => {
    const lf = await dbWith08();
    const crlf = await dbWith08((t) => t.replace(/\n/g, "\r\n"));
    try {
      expect(await diagnosticVerdict(lf)).toMatch(/^B\)/);
      expect(await diagnosticVerdict(crlf)).toMatch(/^B\)/);
      const corpo = (await crlf.query<{ item: string; encontrado: string }>(diagnostic08)).rows.find((r) => r.item === "corpo da função")!;
      expect(corpo.encontrado).toBe("igual à migration 08 (com quebras de linha CRLF)");
    } finally {
      await lf.close();
      await crlf.close();
    }
  });

  it("uma função de lógica diferente continua sendo acusada (E), com o md5 na tela", async () => {
    const db = await dbWith08((t) => t.replace("raise exception 'tabela não auditada: %', tg_table_name;", "raise exception 'tabela nao auditada: %', tg_table_name;"));
    try {
      expect(await diagnosticVerdict(db)).toMatch(/^E\)/);
      const corpo = (await db.query<{ item: string; encontrado: string }>(diagnostic08)).rows.find((r) => r.item === "corpo da função")!;
      expect(corpo.encontrado).toMatch(/^DIFERENTE de 08 e 10 \(md5 sem CR [0-9a-f]{32}\)$/);
    } finally {
      await db.close();
    }
  });
});

describe("supabase/diagnostico-audit-row-change.sql (evidência, somente leitura)", () => {
  it("não escreve nada", () => {
    for (const q of [evidence, bodyQuery]) {
      // fora dos textos entre aspas (a consulta cita "CREATE TRIGGER ... INSERT OR UPDATE" como valor esperado)
      expect(q.replace(/'[^']*'/g, "''")).not.toMatch(/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum)\b/i);
    }
  });

  it("banco correto (LF): tudo ok e veredito 'igual byte a byte'", async () => {
    const db = await dbWith08();
    try {
      const rows = await evidenceRows(db);
      const byItem = (start: string) => rows.find((r) => r.item.startsWith(start))!;
      expect(byItem("tamanho do corpo").encontrado).toBe("2510 bytes, 0 CR");
      expect(byItem("md5 do corpo, bruto").situacao).toBe("ok");
      expect(byItem("dono").situacao).toBe("ok");
      expect(byItem("EXECUTE").situacao).toBe("ok");
      const triggers = rows.filter((r) => r.item.startsWith("trigger "));
      expect(triggers).toHaveLength(4);
      for (const t of triggers) expect(t, t.item).toMatchObject({ situacao: "ok" });
      expect(await evidenceVerdict(db)).toMatch(/^IGUAL à migration 08 \(byte a byte\)/);
    } finally {
      await db.close();
    }
  });

  it("banco com CRLF: bruto DIVERGE, sem CR ok, veredito explica o falso positivo", async () => {
    const db = await dbWith08((t) => t.replace(/\n/g, "\r\n"));
    try {
      const rows = await evidenceRows(db);
      expect(rows.find((r) => r.item.startsWith("md5 do corpo, bruto"))!.situacao).toBe("DIVERGE");
      expect(rows.find((r) => r.item.startsWith("md5 do corpo sem os CR"))!.situacao).toBe("ok");
      expect(rows.find((r) => r.item.startsWith("tamanho do corpo"))!.encontrado).toMatch(/^\d+ bytes, [1-9]\d* CR$/);
      expect(await evidenceVerdict(db)).toMatch(/exceto as quebras de linha \(CRLF em vez de LF\).*falso positivo/);
    } finally {
      await db.close();
    }
  });

  it("espaços no fim das linhas também são tolerados, mas lógica diferente é acusada", async () => {
    const trailing = await dbWith08((t) => t.replace(/;\n/g, ";   \n"));
    const changed = await dbWith08((t) => t.replace("v_entity := 'client'", "v_entity := 'cliente'"));
    try {
      expect(await evidenceVerdict(trailing)).toMatch(/espaços no fim das linhas/);
      expect(await evidenceVerdict(changed)).toMatch(/^DIFERENTE da migration 08 mesmo ignorando CRLF e espaços/);
    } finally {
      await trailing.close();
      await changed.close();
    }
  });

  it("detecta privilégio indevido e trigger ausente ou desabilitado", async () => {
    const db = await dbWith08();
    try {
      await db.exec("grant execute on function app.audit_row_change() to anon");
      expect((await evidenceRows(db)).find((r) => r.item.startsWith("EXECUTE"))!.situacao).toBe("DIVERGE");
      await db.exec("revoke execute on function app.audit_row_change() from anon");
      await db.exec("alter table public.projects disable trigger projects_audit_row");
      await db.exec("drop trigger approvers_audit_row on public.approvers");
      const triggers = (await evidenceRows(db)).filter((r) => r.item.startsWith("trigger "));
      expect(triggers.find((r) => r.item.includes("projects_audit_row"))).toMatchObject({ situacao: "DIVERGE" });
      expect(triggers.find((r) => r.item.includes("approvers_audit_row"))).toMatchObject({ encontrado: "AUSENTE", situacao: "DIVERGE" });
    } finally {
      await db.close();
    }
  });

  it("função ausente (08 não aplicada): veredito próprio, sem erro", async () => {
    const db = await createTestDb({ migrate: false });
    try {
      for (let i = 0; i < M08; i++) await db.exec(read(i));
      expect(await evidenceVerdict(db)).toMatch(/^FUNÇÃO AUSENTE/);
    } finally {
      await db.close();
    }
  });

  it("a consulta do corpo devolve a definição, com CR visível", async () => {
    const db = await dbWith08((t) => t.replace(/\n/g, "\r\n"));
    try {
      const { rows } = await db.query<{ definicao: string; corpo_visivel: string; caracteres: number }>(bodyQuery);
      expect(rows).toHaveLength(1);
      expect(rows[0].definicao).toContain("audit_row_change");
      expect(rows[0].corpo_visivel).toContain("␍⏎");
    } finally {
      await db.close();
    }
  });
});
