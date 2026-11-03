/**
 * Escolha da empresa no portal. Funções puras (sem acesso ao banco nem a cookies) para a regra ser
 * testável: o servidor monta a lista de vínculos pela RLS e aplica `pickPortalContext`.
 */

export interface PortalLink {
  approverId: string;
  clientId: string;
  clientName: string;
}

export type PortalResolution =
  /** Há exatamente um vínculo, ou o cookie aponta para um vínculo válido. */
  | { kind: "ok"; context: PortalLink; links: PortalLink[] }
  /** Vários vínculos e nenhuma escolha válida: o usuário precisa escolher a empresa. NUNCA se escolhe sozinho. */
  | { kind: "choose"; links: PortalLink[] }
  /** Nenhum vínculo ativo: sem acesso ao portal. */
  | { kind: "none" };

/** Ordem estável (nome da empresa e, no empate, o id): a lista nunca depende da ordem do banco. */
export function sortLinks(links: PortalLink[]): PortalLink[] {
  return [...links].sort(
    (a, b) => a.clientName.localeCompare(b.clientName, "pt-BR") || a.clientId.localeCompare(b.clientId),
  );
}

/**
 * `selectedClientId` vem de um cookie e é só uma PREFERÊNCIA: só vale se for um dos vínculos que o
 * banco devolveu agora (já filtrados pela RLS). Qualquer outro valor é ignorado.
 */
export function pickPortalContext(links: PortalLink[], selectedClientId: string | null | undefined): PortalResolution {
  const sorted = sortLinks(links);
  if (sorted.length === 0) return { kind: "none" };
  if (sorted.length === 1) return { kind: "ok", context: sorted[0], links: sorted };
  const chosen = selectedClientId ? sorted.find((link) => link.clientId === selectedClientId) : undefined;
  return chosen ? { kind: "ok", context: chosen, links: sorted } : { kind: "choose", links: sorted };
}
