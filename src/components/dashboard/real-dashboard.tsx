import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, FileText, MessageSquareWarning } from "lucide-react";
import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/page-header";
import { StatusBadge, TypeBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WeeklyChart } from "@/components/weekly-chart";
import { computeDashboardKpis, monthLabel, overdueMaterials, upcomingDeadlines, weeklyDecisions } from "@/lib/dashboard/metrics";
import type { DashboardData } from "@/lib/dashboard/queries";
import { formatDate, formatDateTime, formatDuration } from "@/lib/format";

/** Dashboard com dados reais do Supabase. `now` entra por parâmetro (a página o lê depois de `connection()`). */
export function RealDashboard({ data, now }: { data: DashboardData; now: Date }) {
  const { materials, decisions } = data;
  const kpis = computeDashboardKpis(materials, decisions, now);
  const weekly = weeklyDecisions(decisions, now, 6);
  const overdue = overdueMaterials(materials, now);
  const upcoming = upcomingDeadlines(materials, now);
  const recentMaterials = materials.slice(0, 8);
  const recentDecisions = decisions.slice(0, 5);
  const titleOf = (id: string) => materials.find((m) => m.id === id)?.title ?? "Material";
  const empty = materials.length === 0;

  return (
    <>
      <PageHeader title="Dashboard" description="Visão geral das aprovações de todos os clientes da Luvi." />

      <section aria-label="Indicadores" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Aguardando aprovação" value={kpis.aguardando} hint={`${kpis.atrasados} com prazo vencido`} icon={Clock} tone="warning" />
        <KpiCard label="Alterações solicitadas" value={kpis.alteracao} hint="Pendentes de nova versão" icon={MessageSquareWarning} tone="primary" />
        <KpiCard label="Aprovados no mês" value={kpis.aprovadosNoMes} hint={monthLabel(now)} icon={CheckCircle2} tone="success" />
        <KpiCard label="Rascunhos em produção" value={kpis.rascunhos} hint={`${kpis.aprovados} aprovados no total`} icon={FileText} />
      </section>

      <p className="mt-3 text-xs text-muted-foreground">
        {data.activeClients} {data.activeClients === 1 ? "cliente ativo" : "clientes ativos"} · {data.activeProjects}{" "}
        {data.activeProjects === 1 ? "projeto ativo" : "projetos ativos"} · {materials.length} {materials.length === 1 ? "material" : "materiais"}
        {kpis.tempoMedioAprovacaoHoras !== null && <> · tempo médio de aprovação {formatDuration(kpis.tempoMedioAprovacaoHoras)}</>}
        {data.truncated && " · mostrando os 1000 mais recentes"}
      </p>

      {empty && (
        <p role="status" className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-muted-foreground">
          Ainda não há materiais cadastrados. Comece por <Link href="/admin/clientes" className="text-primary underline-offset-4 hover:underline">clientes</Link>,
          depois <Link href="/admin/projetos" className="text-primary underline-offset-4 hover:underline">projetos</Link> e{" "}
          <Link href="/admin/materiais" className="text-primary underline-offset-4 hover:underline">materiais</Link>.
        </p>
      )}

      {overdue.length > 0 && (
        <section aria-label="Prazos vencidos" className="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <p role="status" className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            {kpis.atrasados} {kpis.atrasados === 1 ? "material está" : "materiais estão"} com o prazo de aprovação vencido.
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {overdue.map((m) => (
              <li key={m.id}>
                <Link href={`/admin/materiais/${m.id}`} className="underline-offset-4 hover:underline">
                  {m.title}
                </Link>{" "}
                <span className="text-xs">
                  · {m.clientName} · venceu em {formatDate(m.dueDate!)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Decisões por semana</CardTitle>
          </CardHeader>
          <CardContent>
            {decisions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma decisão registrada ainda. As aprovações aparecem aqui quando o fluxo de aprovação entrar em uso.</p>
            ) : (
              <WeeklyChart data={weekly} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Próximos prazos</CardTitle>
          </CardHeader>
          <CardContent>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum material com prazo de aprovação marcado.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {upcoming.map((m) => (
                  <li key={m.id} className="flex items-start justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <Link href={`/admin/materiais/${m.id}`} className="block truncate font-medium text-white underline-offset-4 hover:text-primary hover:underline">
                        {m.title}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">{m.clientName}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatDate(m.dueDate!)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>Materiais recentes</CardTitle>
            <Link href="/admin/materiais" className="text-sm text-primary underline-offset-4 hover:underline">
              Ver todos
            </Link>
          </CardHeader>
          <CardContent>
            {recentMaterials.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum material ainda.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-white/10">
                {recentMaterials.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <div className="min-w-0">
                      <Link href={`/admin/materiais/${m.id}`} className="block truncate font-medium text-white underline-offset-4 hover:text-primary hover:underline">
                        {m.title}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">{m.clientName}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <TypeBadge type={m.type} />
                      <StatusBadge status={m.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Atividade recente</CardTitle>
          </CardHeader>
          <CardContent>
            {recentDecisions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma decisão de aprovadores ainda.</p>
            ) : (
              <ol className="flex flex-col gap-4">
                {recentDecisions.map((d) => (
                  <li key={d.id} className="text-sm">
                    <p className="text-white">
                      <span className="font-semibold">{d.by}</span> {d.decision === "aprovado" ? "aprovou" : "pediu alteração em"}{" "}
                      <Link href={`/admin/materiais/${d.materialId}`} className="text-primary underline-offset-4 hover:underline">
                        {titleOf(d.materialId)}
                      </Link>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(d.at)} · via {d.via === "link" ? "link seguro" : "portal"}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </section>
    </>
  );
}
