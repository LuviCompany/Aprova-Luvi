/**
 * Agrupamento de aprovadores por PESSOA. No banco, um aprovador é uma linha por cliente; a mesma
 * pessoa em vários clientes aparece em várias linhas com o mesmo e-mail (e, se houver, o mesmo
 * login). Funções puras, sem acesso ao banco.
 */

export interface OtherApproverRow {
  id: string;
  clientId: string;
  clientName: string;
  email: string;
  name: string;
  jobTitle: string;
  active: boolean;
  hasLogin: boolean;
}

export interface LinkCandidate {
  /** Linha usada como origem do vínculo (prefere a que já tem login). */
  sourceApproverId: string;
  name: string;
  email: string;
  jobTitle: string;
  hasLogin: boolean;
  /** Clientes em que a pessoa já é aprovadora ativa. */
  clientNames: string[];
}

const key = (email: string) => email.trim().toLowerCase();

/** Para cada e-mail do cliente atual, os OUTROS clientes em que a pessoa aprova (só vínculos ativos). */
export function alsoApprovesFor(rows: OtherApproverRow[], emails: string[]): Map<string, string[]> {
  const wanted = new Set(emails.map(key));
  const out = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.active || !wanted.has(key(row.email))) continue;
    const list = out.get(key(row.email)) ?? [];
    if (!list.includes(row.clientName)) list.push(row.clientName);
    out.set(key(row.email), list.sort((a, b) => a.localeCompare(b, "pt-BR")));
  }
  return out;
}

/**
 * Pessoas de OUTROS clientes que ainda não estão neste (nem como inativas): quem pode ser
 * vinculado. Ordenado por nome.
 */
export function buildLinkCandidates(rows: OtherApproverRow[], emailsAlreadyHere: string[]): LinkCandidate[] {
  const here = new Set(emailsAlreadyHere.map(key));
  const byPerson = new Map<string, LinkCandidate>();
  for (const row of rows) {
    if (!row.active || here.has(key(row.email))) continue;
    const existing = byPerson.get(key(row.email));
    if (!existing) {
      byPerson.set(key(row.email), {
        sourceApproverId: row.id,
        name: row.name,
        email: row.email,
        jobTitle: row.jobTitle,
        hasLogin: row.hasLogin,
        clientNames: [row.clientName],
      });
      continue;
    }
    if (!existing.clientNames.includes(row.clientName)) existing.clientNames.push(row.clientName);
    if (row.hasLogin && !existing.hasLogin) {
      existing.sourceApproverId = row.id;
      existing.hasLogin = true;
    }
  }
  return [...byPerson.values()]
    .map((c) => ({ ...c, clientNames: [...c.clientNames].sort((a, b) => a.localeCompare(b, "pt-BR")) }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR") || a.email.localeCompare(b.email));
}
