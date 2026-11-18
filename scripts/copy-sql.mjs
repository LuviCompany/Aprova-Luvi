// Copia para a área de transferência um SQL do projeto (migration, preflight ou verificação), conferindo
// o SHA-256 contra supabase/sql-manifest.sha256 ANTES e DEPOIS de copiar (o texto lido de volta da área de
// transferência precisa ter o mesmo hash). Não abre conexão, não envia nada e não altera banco.
//
// Uso (PowerShell ou Terminal do app, na pasta do projeto):
//   node scripts/copy-sql.mjs --list
//   node scripts/copy-sql.mjs 1            (migration 1 de 15)
//   node scripts/copy-sql.mjs preflight
//   node scripts/copy-sql.mjs verify       (verify-summary.sql: 31 blocos em uma tabela)
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const supabaseDir = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase");

/** Lê o manifesto "hash  caminho" (formato do sha256sum). */
export function readManifest(text) {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [hash, ...rest] = line.trim().split(/\s+/);
      return { hash, path: rest.join(" ") };
    });
}

/** O pré-voo tem vários blocos, e o SQL Editor mostra só o último resultado: copiamos só o bloco SUMMARY. */
export function payloadFor(entry, text) {
  if (entry.path !== "preflight.sql") return { payload: text, note: "" };
  const m = text.match(/^select verificacao, violacoes[\s\S]*?^order by ordem;$/m);
  if (!m) throw new Error("bloco SUMMARY do preflight.sql não encontrado");
  return { payload: `${m[0]}\n`, note: " (somente o bloco SUMMARY, que é o que se roda primeiro)" };
}

export const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/** Escolhe a entrada pelo número da migration (1-15), por "preflight", "verify" ou pelo nome do arquivo. */
export function pickEntry(entries, arg) {
  const migrations = entries.filter((e) => e.path.startsWith("migrations/"));
  if (/^\d+$/.test(arg)) return migrations[Number(arg) - 1] ?? null;
  if (arg === "preflight") return entries.find((e) => e.path === "preflight.sql") ?? null;
  if (arg === "verify") return entries.find((e) => e.path === "verify-summary.sql") ?? null;
  return entries.find((e) => basename(e.path) === arg || basename(e.path) === `${arg}.sql`) ?? null;
}

function clipboardRun(script, env) {
  return spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function main() {
  const entries = readManifest(readFileSync(join(supabaseDir, "sql-manifest.sha256"), "utf8"));
  const arg = process.argv[2];
  if (!arg || arg === "--list") {
    entries.forEach((e, i) => {
      const n = e.path.startsWith("migrations/") ? String(i + 1).padStart(2, "0") : "--";
      console.log(`${n}  ${e.hash}  ${basename(e.path)}`);
    });
    return;
  }
  const entry = pickEntry(entries, arg);
  if (!entry) {
    console.error(`Não encontrei "${arg}". Use --list para ver as opções.`);
    process.exit(1);
  }
  const file = join(supabaseDir, entry.path);
  const text = readFileSync(file, "utf8");
  if (text.includes("\r")) {
    console.error("ERRO: o arquivo tem quebras de linha CRLF; o hash do manifesto vale para LF. Não use este arquivo.");
    process.exit(1);
  }
  const actual = sha256(text);
  if (actual !== entry.hash) {
    console.error(`ERRO: o arquivo ${basename(entry.path)} NÃO confere com o manifesto.\n  esperado ${entry.hash}\n  obtido   ${actual}\nNão aplique. Avise o assistente.`);
    process.exit(1);
  }

  const { payload, note } = payloadFor(entry, text);
  const tmp = mkdtempSync(join(tmpdir(), "aprova-sql-"));
  const tmpFile = join(tmp, "copia.sql");
  writeFileSync(tmpFile, payload, "utf8");
  const copy = clipboardRun("[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Content -Raw -Encoding UTF8 -LiteralPath $env:SQL_FILE | Set-Clipboard", { SQL_FILE: tmpFile });
  rmSync(tmp, { recursive: true, force: true });
  if (copy.status !== 0) {
    console.error("Não consegui copiar para a área de transferência (PowerShell).");
    process.exit(1);
  }
  const back = clipboardRun("[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw", {});
  const clip = (back.stdout ?? "").replace(/\r\n/g, "\n").replace(/\n$/, "");
  const want = sha256(payload);
  const same = sha256(clip) === want || sha256(`${clip}\n`) === want;
  console.log(`Arquivo   ${basename(entry.path)}  (${Buffer.byteLength(text, "utf8")} bytes)${note}`);
  console.log(`SHA-256   ${actual}`);
  console.log(`Manifesto confere: sim`);
  console.log(`Área de transferência confere: ${same ? "sim" : "NÃO (não cole; avise o assistente)"}`);
  if (!same) process.exit(1);
  console.log("Pronto: cole no SQL Editor (Ctrl+V) e clique em Run.");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
