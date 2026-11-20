// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUCTION_PROJECT_HOSTS } from "../../scripts/bootstrap-admin.mjs";
import { PRODUCTION_SUPABASE_HOST } from "@/lib/env";

/**
 * Guarda de identidade do projeto Supabase de PRODUÇÃO. Um identificador digitado errado (uma letra) já chegou
 * a documentos, scripts e à constante que trava os scripts de produção. Os dois valores abaixo são montados em
 * partes de propósito: assim este arquivo nunca contém o texto completo do identificador incorreto.
 */
const TAIL = "ynmebffxctqlrwqo";
const CORRECT_REF = ["nvtj", TAIL].join("");
const WRONG_REF = ["nvti", TAIL].join("");
const root = process.cwd();

function trackedAndNewFiles(): string[] | null {
  try {
    const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return out.split("\0").filter(Boolean);
  } catch {
    return null; // sem git (por exemplo, pasta exportada): a varredura abaixo é pulada
  }
}

const TEXT_EXT = /\.(md|mjs|cjs|js|ts|tsx|json|ps1|sql|toml|yml|yaml|txt|html|css|sha256|example)$/i;

describe("identidade do projeto Supabase de produção", () => {
  it("a constante usada pelo env:check:prod e pelos scripts é o projeto confirmado no painel", () => {
    expect(PRODUCTION_SUPABASE_HOST).toBe(`${CORRECT_REF}.supabase.co`);
  });

  it("o bootstrap-admin usa exatamente a mesma constante (fonte única)", () => {
    expect(PRODUCTION_PROJECT_HOSTS).toEqual([PRODUCTION_SUPABASE_HOST]);
  });

  it.skipIf(trackedAndNewFiles() === null)("nenhum arquivo versionado ou novo contém o identificador incorreto", () => {
    const offenders = (trackedAndNewFiles() ?? []).filter((file) => {
      if (!TEXT_EXT.test(file)) return false;
      const full = join(root, file);
      try {
        if (statSync(full).size > 4 * 1024 * 1024) return false;
        return readFileSync(full, "utf8").toLowerCase().includes(WRONG_REF);
      } catch {
        return false; // arquivo removido na árvore de trabalho
      }
    });
    expect(offenders).toEqual([]);
  });

  it("os guias e o script de backup citam o mesmo projeto da constante", () => {
    const mustMention: Array<[string, string]> = [
      ["docs/VERCEL-PRODUCAO.md", PRODUCTION_SUPABASE_HOST],
      ["docs/PRODUCAO-BANCO.md", PRODUCTION_SUPABASE_HOST],
      ["docs/BACKUP.md", PRODUCTION_SUPABASE_HOST],
      ["scripts/backup-db.ps1", CORRECT_REF],
    ];
    for (const [file, needle] of mustMention) {
      expect(readFileSync(join(root, file), "utf8"), file).toContain(needle);
    }
  });
});
