/**
 * Limitador de tentativas em memória (janela deslizante), por chave (ex.: IP + ação). É uma barreira EXTRA,
 * de melhor esforço, contra abuso (cada instância do servidor tem a sua memória): os limites que valem de
 * verdade ficam no banco (5 tentativas por código, 1 código por minuto e 5 por hora, por link).
 */
const hits = new Map<string, number[]>();

export function allow(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    for (const [k, list] of hits) if (list.every((t) => now - t >= windowMs)) hits.delete(k);
  }
  return true;
}

/** Só para testes. */
export function resetRateLimits(): void {
  hits.clear();
}
