import type {
  ApprovalLink,
  Client,
  Decision,
  LinkState,
  Material,
  MaterialStatus,
  MaterialType,
  Project,
} from "@/lib/types";

export const STATUS_LABEL: Record<MaterialStatus, string> = {
  rascunho: "Rascunho",
  aguardando: "Aguardando aprovação",
  alteracao: "Alteração solicitada",
  aprovado: "Aprovado",
};

export const TYPE_LABEL: Record<MaterialType, string> = {
  imagem: "Imagem",
  carrossel: "Carrossel",
  video: "Vídeo",
  pdf: "PDF",
};

export const LINK_STATE_LABEL: Record<LinkState, string> = {
  valido: "Link válido",
  expirado: "Link expirado",
  revogado: "Link revogado",
  utilizado: "Link já utilizado",
};

/** Estado de um link de aprovação rápida. Revogação vence expiração, que vence uso. */
export function resolveLinkState(link: ApprovalLink | undefined, now: Date | string): LinkState {
  if (!link) return "revogado";
  if (link.revokedAt) return "revogado";
  if (new Date(link.expiresAt).getTime() <= new Date(now).getTime()) return "expirado";
  if (link.usedAt) return "utilizado";
  return "valido";
}

/** E-mail mascarado para confirmação de identidade: ma***@casaaurora.example. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "***";
  return `${user.slice(0, 2)}***@${domain}`;
}

export function isOverdue(material: Material, now: Date | string): boolean {
  if (material.status !== "aguardando" && material.status !== "alteracao") return false;
  const due = new Date(`${material.dueDate}T23:59:59-03:00`).getTime();
  return due < new Date(now).getTime();
}

export interface MaterialFilters {
  clientId?: string;
  status?: MaterialStatus | "todos";
  type?: MaterialType | "todos";
  search?: string;
}

export function filterMaterials(items: Material[], filters: MaterialFilters): Material[] {
  const term = filters.search?.trim().toLowerCase();
  return items.filter((m) => {
    if (filters.clientId && filters.clientId !== "todos" && m.clientId !== filters.clientId) return false;
    if (filters.status && filters.status !== "todos" && m.status !== filters.status) return false;
    if (filters.type && filters.type !== "todos" && m.type !== filters.type) return false;
    if (term && !m.title.toLowerCase().includes(term)) return false;
    return true;
  });
}

export interface Kpis {
  aguardando: number;
  alteracao: number;
  aprovadosNoMes: number;
  atrasados: number;
  /** Horas médias entre envio e aprovação, considerando só decisões "aprovado". */
  tempoMedioAprovacaoHoras: number | null;
}

export function computeKpis(
  materials: Material[],
  decisions: Decision[],
  now: Date | string,
): Kpis {
  const ref = new Date(now);
  const approvals = decisions.filter((d) => d.decision === "aprovado");
  const inMonth = approvals.filter((d) => {
    const at = new Date(d.at);
    return at.getFullYear() === ref.getFullYear() && at.getMonth() === ref.getMonth();
  });

  const durations = approvals
    .map((d) => {
      const material = materials.find((m) => m.id === d.materialId);
      const version = material?.versions.find((ver) => ver.number === d.version);
      if (!version) return null;
      return (new Date(d.at).getTime() - new Date(version.createdAt).getTime()) / 36e5;
    })
    .filter((h): h is number => h !== null && h >= 0);

  return {
    aguardando: materials.filter((m) => m.status === "aguardando").length,
    alteracao: materials.filter((m) => m.status === "alteracao").length,
    aprovadosNoMes: inMonth.length,
    atrasados: materials.filter((m) => isOverdue(m, ref)).length,
    tempoMedioAprovacaoHoras: durations.length
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : null,
  };
}

export interface WeeklyPoint {
  label: string;
  aprovados: number;
  alteracoes: number;
}

/** Decisões agrupadas nas últimas `weeks` semanas (a mais recente por último). */
export function decisionsByWeek(decisions: Decision[], now: Date | string, weeks = 6): WeeklyPoint[] {
  const ref = new Date(now).getTime();
  const weekMs = 7 * 24 * 36e5;
  const points: WeeklyPoint[] = Array.from({ length: weeks }, (_, i) => ({
    label: i === weeks - 1 ? "Esta semana" : `-${weeks - 1 - i} sem`,
    aprovados: 0,
    alteracoes: 0,
  }));
  for (const d of decisions) {
    const age = ref - new Date(d.at).getTime();
    if (age < 0) continue;
    const bucket = Math.floor(age / weekMs);
    if (bucket >= weeks) continue;
    const point = points[weeks - 1 - bucket];
    if (d.decision === "aprovado") point.aprovados += 1;
    else point.alteracoes += 1;
  }
  return points;
}

export function clientById(id: string, list: Client[]): Client | undefined {
  return list.find((c) => c.id === id);
}

export function projectById(id: string, list: Project[]): Project | undefined {
  return list.find((p) => p.id === id);
}
