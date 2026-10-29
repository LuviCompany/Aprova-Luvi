import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, MessageSquareWarning, Timer } from "lucide-react";
import { KpiCard } from "@/components/kpi-card";
import { MaterialsTable } from "@/components/materials-table";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WeeklyChart } from "@/components/weekly-chart";
import { LINK_STATE_LABEL, computeKpis, decisionsByWeek, resolveLinkState } from "@/lib/domain";
import { formatDate, formatDateTime, formatDuration } from "@/lib/format";
import { NOW, approvalLinks, clients, decisions, materials } from "@/lib/mock/data";
import type { LinkState } from "@/lib/types";

export const metadata: Metadata = { title: "Dashboard" };

const LINK_STYLE: Record<LinkState, string> = {
  valido: "border-success/30 bg-success/10 text-success",
  expirado: "border-warning/30 bg-warning/10 text-warning",
  revogado: "border-destructive/30 bg-destructive/10 text-destructive",
  utilizado: "border-white/15 bg-white/5 text-muted-foreground",
};

export default function AdminDashboardPage() {
  const kpis = computeKpis(materials, decisions, NOW);
  const weekly = decisionsByWeek(decisions, NOW, 6);
  const recent = [...decisions].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
  const materialTitle = (id: string) => materials.find((m) => m.id === id)?.title ?? "Material";

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Visão geral das aprovações de todos os clientes da Luvi."
      />

      <section aria-label="Indicadores" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Aguardando aprovação" value={kpis.aguardando} hint={`${kpis.atrasados} com prazo vencido`} icon={Clock} tone="warning" />
        <KpiCard label="Alterações solicitadas" value={kpis.alteracao} hint="Pendentes de nova versão" icon={MessageSquareWarning} tone="primary" />
        <KpiCard label="Aprovados no mês" value={kpis.aprovadosNoMes} hint="Outubro de 2026" icon={CheckCircle2} tone="success" />
        <KpiCard label="Tempo médio de aprovação" value={formatDuration(kpis.tempoMedioAprovacaoHoras)} hint="Do envio à decisão" icon={Timer} />
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Decisões por semana</CardTitle>
          </CardHeader>
          <CardContent>
            <WeeklyChart data={weekly} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Links de aprovação</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3">
              {approvalLinks.map((link) => {
                const state = resolveLinkState(link, NOW);
                return (
                  <li key={link.token} className="flex items-start justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{materialTitle(link.materialId)}</p>
                      <p className="text-xs text-muted-foreground">Expira em {formatDate(link.expiresAt)}</p>
                    </div>
                    <Badge variant="outline" className={LINK_STYLE[state]}>
                      {LINK_STATE_LABEL[state]}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </section>

      {kpis.atrasados > 0 && (
        <p
          role="status"
          className="mt-6 flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {kpis.atrasados} {kpis.atrasados === 1 ? "material está" : "materiais estão"} com o prazo de
          aprovação vencido.
        </p>
      )}

      <section className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>Materiais</CardTitle>
          </CardHeader>
          <CardContent>
            <MaterialsTable materials={materials} clients={clients} detailBase="/admin/materiais" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Atividade recente</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-4">
              {recent.map((d) => (
                <li key={d.id} className="text-sm">
                  <p className="text-white">
                    <span className="font-semibold">{d.by}</span>{" "}
                    {d.decision === "aprovado" ? "aprovou" : "pediu alteração em"}{" "}
                    <Link
                      href={`/admin/materiais/${d.materialId}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {materialTitle(d.materialId)}
                    </Link>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(d.at)} · via {d.via === "link" ? "link seguro" : "portal"}
                  </p>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </section>
    </>
  );
}
