// @vitest-environment node
import { describe, expect, it } from "vitest";
import { summarize, verdict } from "../../scripts/check-network.mjs";

const healthy = [20, 25, 18, 30, 22, 19, 21, 24, 27, 23, 20, 26];
// Padrão real visto em 2026-11-02: retransmissões de SYN (~1 s, ~3 s) e timeouts.
const lossy = [47, 1033, null, null, 27, 1029, 1039, 3027, 18, 1028, 21, null];

describe("check-network", () => {
  it("conta falhas e conexões lentas", () => {
    expect(summarize(healthy)).toMatchObject({ total: 12, failed: 0, slow: 0, bad: 0, lossy: false });
    expect(summarize(lossy)).toMatchObject({ total: 12, failed: 3, slow: 5, bad: 8, lossy: true });
  });

  it("sem amostras não é considerado com perda", () => {
    expect(summarize([]).lossy).toBe(false);
  });

  it("culpa a rede local quando os destinos de controle também perdem pacotes", () => {
    expect(verdict(summarize(lossy), [summarize(lossy), summarize(lossy)])).toMatch(/rede local ou provedor/);
  });

  it("culpa o caminho até o Supabase só quando os controles estão saudáveis", () => {
    expect(verdict(summarize(lossy), [summarize(healthy), summarize(healthy)])).toMatch(/caminho até o Supabase/);
  });

  it("é inconclusivo quando só parte dos controles perde pacotes", () => {
    expect(verdict(summarize(lossy), [summarize(lossy), summarize(healthy)])).toMatch(/inconclusivo/);
  });

  it("não aponta problema quando o Supabase está saudável", () => {
    expect(verdict(summarize(healthy), [summarize(lossy)])).toMatch(/^ok/);
  });
});
