// Gera supabase/verify-summary.sql a partir de supabase/verify.sql.
//
// O SQL Editor do Supabase só mostra o resultado da ÚLTIMA consulta de um script. O verify.sql tem um
// bloco por regra (31 hoje); esta versão resume todos numa única tabela: uma linha por bloco, com a
// contagem de violações (o esperado é 0 em todas). Os mesmos blocos, sem alteração, são embrulhados
// em "select count(*)", então o verify.sql continua sendo a única fonte da verdade.
//
// Uso: node scripts/build-verify-summary.mjs [--check]
//   (sem argumento) reescreve supabase/verify-summary.sql
//   --check         só confere se o arquivo versionado está em dia (sai com 1 se não estiver)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(root, "supabase", "verify.sql");
const TARGET = join(root, "supabase", "verify-summary.sql");

/** Extrai os blocos "-- CHECK: título" do verify.sql. */
export function parseChecks(sql) {
  return sql
    .replace(/\r\n/g, "\n")
    .split(/^-- CHECK: /m)
    .slice(1)
    .map((block) => {
      const [title, ...rest] = block.split("\n");
      return { title: title.trim(), query: rest.join("\n").replace(/^--.*$/gm, "").trim().replace(/;\s*$/, "") };
    });
}

/** Monta o script único: uma linha por bloco (bloco, verificacao, violacoes), em ordem. */
export function buildVerifySummary(sql) {
  const checks = parseChecks(sql);
  const quote = (text) => `'${text.replace(/'/g, "''")}'`;
  const rows = checks.map(
    (c, i) =>
      `select ${i + 1} as bloco, ${quote(c.title)} as verificacao, (select count(*) from (\n${c.query}\n) t) as violacoes`,
  );
  const header = [
    "-- Aprova Luvi — verificação PÓS-MIGRATION em UMA tabela (somente leitura).",
    "-- GERADO por scripts/build-verify-summary.mjs a partir de supabase/verify.sql: não edite à mão.",
    `-- Cole TUDO no SQL Editor e clique em Run. Resultado esperado: ${checks.length} linhas, TODAS com violacoes = 0.`,
    "-- Se alguma linha tiver violacoes > 0, pare e rode, sozinho, o bloco de mesmo título do verify.sql.",
    "",
  ].join("\n");
  return `${header}${rows.join("\nunion all\n")}\norder by bloco;\n`;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const generated = buildVerifySummary(readFileSync(SOURCE, "utf8"));
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(TARGET, "utf8").replace(/\r\n/g, "\n");
    } catch {
      // arquivo ausente
    }
    if (current !== generated) {
      console.error("supabase/verify-summary.sql está desatualizado: rode `node scripts/build-verify-summary.mjs`.");
      process.exit(1);
    }
    console.log("verify-summary.sql em dia.");
  } else {
    writeFileSync(TARGET, generated, "utf8");
    console.log(`Gerado ${TARGET} (${parseChecks(readFileSync(SOURCE, "utf8")).length} blocos).`);
  }
}
