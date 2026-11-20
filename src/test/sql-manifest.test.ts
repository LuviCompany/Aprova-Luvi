// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pickEntry, readManifest, sha256 } from "../../scripts/copy-sql.mjs";

/**
 * supabase/sql-manifest.sha256 é a lista oficial (ordem + SHA-256) usada para aplicar as migrations num
 * projeto novo. Migrations são imutáveis: qualquer divergência aqui significa que um arquivo mudou.
 */
const dir = join(process.cwd(), "supabase");
const entries: { hash: string; path: string }[] = readManifest(readFileSync(join(dir, "sql-manifest.sha256"), "utf8"));

describe("supabase/sql-manifest.sha256", () => {
  it("lista as migrations na ordem dos arquivos, sem faltar nem sobrar", () => {
    const onDisk = readdirSync(join(dir, "migrations")).filter((f) => f.endsWith(".sql")).sort();
    const listed = entries.filter((e) => e.path.startsWith("migrations/")).map((e) => e.path.replace("migrations/", ""));
    expect(listed).toEqual(onDisk);
    expect(listed).toHaveLength(17);
  });

  it("cada hash confere com o conteúdo atual (texto com LF)", () => {
    for (const e of entries) {
      const text = readFileSync(join(dir, e.path), "utf8");
      expect(text.includes("\r"), `${e.path} com CRLF`).toBe(false);
      expect(sha256(text), e.path).toBe(e.hash);
    }
  });

  it("inclui o pré-voo e a verificação resumida", () => {
    expect(entries.map((e) => e.path)).toEqual(expect.arrayContaining(["preflight.sql", "verify-summary.sql", "verify-service-role.sql", "verify-team-members.sql"]));
  });

  it("pickEntry escolhe por número, apelido e nome", () => {
    expect(pickEntry(entries, "1")?.path).toBe("migrations/20261102120000_core_schema.sql");
    expect(pickEntry(entries, "15")?.path).toBe("migrations/20261107120000_approvers_portal_own_rows.sql");
    expect(pickEntry(entries, "16")?.path).toBe("migrations/20261120120000_service_role_grants.sql");
    expect(pickEntry(entries, "17")?.path).toBe("migrations/20261121120000_team_members.sql");
    expect(pickEntry(entries, "18")).toBeNull();
    expect(pickEntry(entries, "verify-team-members")?.path).toBe("verify-team-members.sql");
    expect(pickEntry(entries, "verify-service-role")?.path).toBe("verify-service-role.sql");
    expect(pickEntry(entries, "preflight")?.path).toBe("preflight.sql");
    expect(pickEntry(entries, "verify")?.path).toBe("verify-summary.sql");
    expect(pickEntry(entries, "20261102120300_storage")?.path).toBe("migrations/20261102120300_storage.sql");
  });
});
