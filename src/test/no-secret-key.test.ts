// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regra do Módulo 3: operações comuns do painel (clientes, projetos, materiais) rodam com o
 * cliente Supabase DO USUÁRIO, sob a RLS. A chave secreta ignora a RLS e fica reservada a tarefas
 * de servidor que, por natureza, não têm usuário logado (ex.: o fluxo de aprovação por link, no
 * Módulo 4). Este teste vigia as áreas do painel e as ações para que isso não escorregue.
 */

const ROOT = process.cwd();
const AREAS = [
  "src/app/admin",
  "src/components/clients",
  "src/lib/clients",
  "src/lib/auth/action-guard.ts",
];
const FORBIDDEN = [/supabase\/admin/, /createSupabaseAdminClient/, /requireSecretKey/, /SUPABASE_SECRET_KEY/, /service_role/];

function sourceFiles(path: string): string[] {
  const absolute = join(ROOT, path);
  if (statSync(absolute).isFile()) return [absolute];
  return readdirSync(absolute).flatMap((entry) => {
    const full = join(absolute, entry);
    if (statSync(full).isDirectory()) return sourceFiles(relative(ROOT, full));
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

describe("o painel não usa a chave secreta", () => {
  const files = AREAS.flatMap(sourceFiles);

  it("há arquivos a vigiar", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(FORBIDDEN.map((pattern) => [String(pattern)] as const))("nenhum arquivo casa %s", (source) => {
    const pattern = FORBIDDEN.find((p) => String(p) === source)!;
    const offenders = files.filter((file) => pattern.test(readFileSync(file, "utf8"))).map((file) => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });
});
