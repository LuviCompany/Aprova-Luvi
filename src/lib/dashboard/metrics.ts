import type { WeeklyPoint } from "@/lib/domain";
import type { MaterialStatus, MaterialType } from "@/lib/types";

/**
 * Indicadores do dashboard a partir de dados REAIS (Módulo 3, etapa E). Funções puras: a data de referência
 * entra por parâmetro (nunca `Date.now()` aqui), então o resultado é testável e determinístico.
 */

export interface DashboardMaterial {
  id: string;
  title: string;
  type: MaterialType;
  status: MaterialStatus;
  clientName: string;
  /** Prazo de aprovação, `YYYY-MM-DD`. */
  dueDate: string | null;
  createdAt: string;
}

export interface DashboardDecision {
  id: string;
  materialId: string;
  decision: "aprovado" | "alteracao";
  by: string;
  via: "portal" | "link";
  at: string;
  /** Quando a solicitação foi aberta (para o tempo de aprovação). */
  requestedAt: string | null;
}

export interface DashboardKpis {
  aguardando: number;
  alteracao: number;
  rascunhos: number;
  aprovados: number;
  atrasados: number;
  aprovadosNoMes: number;
  tempoMedioAprovacaoHoras: number | null;
}

const BRT = "America/Sao_Paulo";

/** Prazo vencido: material esperando decisão ou alteração cujo prazo (fim do dia, horário de Brasília) já passou. */
export function isOverdueMaterial(material: Pick<DashboardMaterial, "status" | "dueDate">, now: Date): boolean {
  if (material.status !== "aguardando" && material.status !== "alteracao") return false;
  if (!material.dueDate) return false;
  return new Date(`${material.dueDate}T23:59:59-03:00`).getTime() < now.getTime();
}

/** Ano e mês no fuso de Brasília (a virada do mês não pode depender do fuso do servidor). */
function monthKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("pt-BR", { timeZone: BRT, year: "numeric", month: "2-digit" }).formatToParts(date);
  return `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}`;
}

export function computeDashboardKpis(materials: DashboardMaterial[], decisions: DashboardDecision[], now: Date): DashboardKpis {
  const approvals = decisions.filter((d) => d.decision === "aprovado");
  const thisMonth = monthKey(now);
  const durations = approvals
    .map((d) => (d.requestedAt ? (new Date(d.at).getTime() - new Date(d.requestedAt).getTime()) / 36e5 : null))
    .filter((hours): hours is number => hours !== null && Number.isFinite(hours) && hours >= 0);
  const count = (status: MaterialStatus) => materials.filter((m) => m.status === status).length;
  return {
    aguardando: count("aguardando"),
    alteracao: count("alteracao"),
    rascunhos: count("rascunho"),
    aprovados: count("aprovado"),
    atrasados: materials.filter((m) => isOverdueMaterial(m, now)).length,
    aprovadosNoMes: approvals.filter((d) => monthKey(new Date(d.at)) === thisMonth).length,
    tempoMedioAprovacaoHoras: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
  };
}

/** Decisões por semana nas últimas `weeks` semanas (a mais recente por último). */
export function weeklyDecisions(decisions: DashboardDecision[], now: Date, weeks = 6): WeeklyPoint[] {
  const weekMs = 7 * 24 * 36e5;
  const points: WeeklyPoint[] = Array.from({ length: weeks }, (_, i) => ({
    label: i === weeks - 1 ? "Esta semana" : `-${weeks - 1 - i} sem`,
    aprovados: 0,
    alteracoes: 0,
  }));
  for (const d of decisions) {
    const age = now.getTime() - new Date(d.at).getTime();
    if (age < 0) continue;
    const bucket = Math.floor(age / weekMs);
    if (bucket >= weeks) continue;
    const point = points[weeks - 1 - bucket];
    if (d.decision === "aprovado") point.aprovados += 1;
    else point.alteracoes += 1;
  }
  return points;
}

/** Próximos prazos: materiais ainda não aprovados com prazo de hoje em diante, do mais próximo ao mais distante. */
export function upcomingDeadlines(materials: DashboardMaterial[], now: Date, limit = 6): DashboardMaterial[] {
  return materials
    .filter((m) => m.status !== "aprovado" && m.dueDate && !isOverdueMaterial(m, now) && new Date(`${m.dueDate}T23:59:59-03:00`).getTime() >= now.getTime())
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)) || a.title.localeCompare(b.title))
    .slice(0, limit);
}

/** Materiais com prazo vencido, do mais atrasado ao menos. */
export function overdueMaterials(materials: DashboardMaterial[], now: Date, limit = 6): DashboardMaterial[] {
  return materials
    .filter((m) => isOverdueMaterial(m, now))
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
    .slice(0, limit);
}

export const monthLabel = (now: Date): string =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: BRT, month: "long", year: "numeric" }).format(now).replace(/^./, (c) => c.toUpperCase());

/** Solicitação individual ainda aberta (um aprovador que não respondeu). */
export interface DashboardPendingRequest {
  id: string;
  materialId: string;
  approverName: string;
  /** Prazo da solicitação (timestamp) ou `null`. */
  dueAt: string | null;
  createdAt: string;
}

export interface PendingApprovalGroup {
  materialId: string;
  title: string;
  clientName: string;
  approvers: string[];
  oldestAt: string;
  dueAt: string | null;
  overdue: boolean;
}

/**
 * Acompanhamento de status: por material, quem ainda não respondeu. Ordem: vencidos primeiro, depois o
 * envio mais antigo. Solicitações de materiais fora da lista (ex.: além do limite) são ignoradas.
 */
export function groupPendingApprovals(
  materials: Array<Pick<DashboardMaterial, "id" | "title" | "clientName">>,
  pending: DashboardPendingRequest[],
  now: Date,
): PendingApprovalGroup[] {
  const byId = new Map(materials.map((m) => [m.id, m]));
  const groups = new Map<string, PendingApprovalGroup>();
  for (const request of pending) {
    const material = byId.get(request.materialId);
    if (!material) continue;
    const overdue = request.dueAt !== null && Date.parse(request.dueAt) < now.getTime();
    const current = groups.get(request.materialId);
    if (!current) {
      groups.set(request.materialId, {
        materialId: material.id,
        title: material.title,
        clientName: material.clientName,
        approvers: [request.approverName],
        oldestAt: request.createdAt,
        dueAt: request.dueAt,
        overdue,
      });
    } else {
      current.approvers.push(request.approverName);
      if (request.createdAt < current.oldestAt) current.oldestAt = request.createdAt;
      if (request.dueAt && (!current.dueAt || request.dueAt < current.dueAt)) current.dueAt = request.dueAt;
      current.overdue = current.overdue || overdue;
    }
  }
  return [...groups.values()]
    .map((g) => ({ ...g, approvers: [...g.approvers].sort((a, b) => a.localeCompare(b, "pt-BR")) }))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.oldestAt.localeCompare(b.oldestAt));
}
