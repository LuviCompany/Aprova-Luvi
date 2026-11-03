#!/usr/bin/env node
/**
 * Diagnostica timeouts de conexão com o Supabase SEM chaves e sem alterar nada: só abre conexões
 * TCP na porta 443 do projeto e de dois destinos de controle, e compara.
 *   npm run net:check
 *
 * Por que existe: em 2026-11-02 o `next dev` e os scripts tiveram `UND_ERR_CONNECT_TIMEOUT`
 * intermitente. O padrão de 1 s / 3 s / timeout é retransmissão de SYN (pacote perdido), e a
 * comparação com os destinos de controle mostrou que era a rede local, não o Supabase.
 * Detalhes em docs/DIAGNOSTICO-REDE.md.
 */
import dns from "node:dns/promises";
import net from "node:net";
import { pathToFileURL } from "node:url";

const CONTROLES = [
  ["Cloudflare DNS", "1.1.1.1"],
  ["Google DNS", "8.8.8.8"],
];
const AMOSTRAS = 12;
const TIMEOUT_MS = 6000;

/** `null` = conexão que falhou ou estourou o tempo; número = milissegundos até conectar. */
export function summarize(samples, slowMs = 500) {
  const failed = samples.filter((s) => s === null).length;
  const slow = samples.filter((s) => s !== null && s > slowMs).length;
  const bad = failed + slow;
  return { total: samples.length, failed, slow, bad, lossy: samples.length > 0 && bad / samples.length >= 0.25 };
}

/** Compara o projeto com os destinos de controle e diz onde está o problema. */
export function verdict(project, controls) {
  if (!project.lossy) return "ok: as conexões com o Supabase estão saudáveis neste momento.";
  const lossyControls = controls.filter((c) => c.lossy).length;
  if (controls.length > 0 && lossyControls === controls.length) {
    return "rede local ou provedor: os destinos de controle também perdem pacotes (não é o Supabase).";
  }
  if (lossyControls === 0) return "caminho até o Supabase: os destinos de controle estão saudáveis.";
  return "inconclusivo: só parte dos destinos de controle perde pacotes. Rode de novo.";
}

function connectOnce(address) {
  return new Promise((resolve) => {
    const started = performance.now();
    const socket = net.connect({ host: address, port: 443, family: 4, timeout: TIMEOUT_MS });
    socket.once("connect", () => {
      socket.destroy();
      resolve(Math.round(performance.now() - started));
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(null);
    });
    socket.once("error", () => resolve(null));
  });
}

async function measure(address) {
  const samples = [];
  for (let i = 0; i < AMOSTRAS; i++) samples.push(await connectOnce(address));
  return samples;
}

const show = (samples) => samples.map((s) => (s === null ? "X" : s)).join(" ");

async function main() {
  const url = process.env.SUPABASE_URL;
  if (!url) {
    console.error("ERRO: defina SUPABASE_URL (npm run net:check já carrega o .env.local).");
    process.exit(1);
  }
  const host = new URL(url).hostname;
  const addresses = await dns.resolve4(host).catch(() => []);
  if (addresses.length === 0) {
    console.error(`ERRO: não foi possível resolver ${host} (DNS).`);
    process.exit(1);
  }

  console.log(`Conexões TCP:443 (${AMOSTRAS} por destino, ms; X = falhou/estourou ${TIMEOUT_MS} ms)\n`);
  const project = [];
  for (const address of addresses) {
    const samples = await measure(address);
    project.push(...samples);
    console.log(`  ${"Supabase".padEnd(15)} ${address.padEnd(15)} ${show(samples)}`);
  }
  const controls = [];
  for (const [name, address] of CONTROLES) {
    const samples = await measure(address);
    controls.push(summarize(samples));
    console.log(`  ${name.padEnd(15)} ${address.padEnd(15)} ${show(samples)}`);
  }

  const p = summarize(project);
  console.log(`\nSupabase: ${p.bad}/${p.total} lentas ou com falha (${p.failed} falhas).`);
  console.log(`Conclusão: ${verdict(p, controls)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
