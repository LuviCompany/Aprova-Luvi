#!/usr/bin/env node
/**
 * Confere as variáveis de ambiente do Aprova Luvi SEM abrir conexão e SEM imprimir chaves.
 *   npm run env:check              (usa o ambiente do terminal)
 *   (o npm run env:check já carrega o .env.local, se existir; variáveis do terminal têm prioridade)
 */
import { diagnoseEnv } from "../src/lib/env.ts";

const d = diagnoseEnv(process.env);
console.log("Resumo (sem valores secretos):");
for (const [k, v] of Object.entries(d.summary)) console.log(`  ${k.padEnd(15)} ${v}`);
for (const w of d.warnings) console.log(`AVISO: ${w}`);
for (const e of d.errors) console.error(`ERRO: ${e}`);
console.log(d.ok ? "\nConfiguração válida." : "\nConfiguração INVÁLIDA.");
process.exit(d.ok ? 0 : 1);
