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
  "src/app/portal",
  "src/components/clients",
  "src/components/approvers",
  "src/components/materials",
  "src/components/portal",
  "src/components/approval",
  "src/lib/approval",
  "src/lib/email",
  "src/lib/auth/portal-guard.ts",
  "src/lib/clients",
  "src/lib/approvers",
  "src/lib/materials",
  "src/lib/auth/action-guard.ts",
  "src/lib/auth/portal-context.ts",
  "src/lib/auth/portal-selection.ts",
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

/**
 * Módulo 4: o fluxo de aprovação por link é a ÚNICA exceção, porque não tem usuário logado. Só estes lugares
 * podem importar o cliente de chave secreta; qualquer outro arquivo do app que o importe reprova aqui.
 */
describe("a chave secreta só aparece onde é inevitável", () => {
  const ALLOWED = ["src/lib/link-approval/", "src/lib/supabase/admin.ts", "scripts/"];
  const all = sourceFiles("src");

  it("somente o fluxo por link (e o próprio cliente admin) importam o cliente de chave secreta", () => {
    const users = all
      .filter((file) => /supabase\/admin|createSupabaseAdminClient|requireSecretKey|SUPABASE_SECRET_KEY/.test(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file).split("\\").join("/"))
      .filter((file) => !file.startsWith("src/lib/env.ts"));
    const offenders = users.filter((file) => !ALLOWED.some((prefix) => file.startsWith(prefix)));
    expect(offenders).toEqual([]);
    expect(users.some((file) => file.startsWith("src/lib/link-approval/"))).toBe(true); // a regra não é vazia
  });

  it("páginas e ações de /aprovar não tocam a chave diretamente: passam pelo serviço do link", () => {
    const aprovar = all
      .map((file) => relative(ROOT, file).split("\\").join("/"))
      .filter((file) => file.startsWith("src/app/aprovar/") && !file.includes(".test."));
    expect(aprovar.length).toBeGreaterThan(2);
    for (const file of aprovar) {
      expect(readFileSync(join(ROOT, file), "utf8"), file).not.toMatch(/supabase\/admin|createSupabaseAdminClient|SUPABASE_SECRET_KEY|service_role/);
    }
  });
});
