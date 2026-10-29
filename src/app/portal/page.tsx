import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusBadge, TypeBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatDate } from "@/lib/format";
import { CURRENT_PORTAL_APPROVER_ID, CURRENT_PORTAL_CLIENT_ID, clients, materials, projects } from "@/lib/mock/data";

export const metadata: Metadata = { title: "Início" };

export default function PortalHomePage() {
  const client = clients.find((c) => c.id === CURRENT_PORTAL_CLIENT_ID)!;
  const approver = client.approvers.find((a) => a.id === CURRENT_PORTAL_APPROVER_ID)!;
  // Isolamento por cliente: o portal só enxerga dados do cliente autenticado (na Fase 2, garantido por RLS).
  const myMaterials = materials.filter((m) => m.clientId === client.id);
  const myProjects = projects.filter((p) => p.clientId === client.id);
  const pending = myMaterials.filter((m) => m.status === "aguardando");

  return (
    <>
      <PageHeader
        title={`Olá, ${approver.name.split(" ")[0]}!`}
        description={`${client.name} · acompanhe e aprove os materiais criados pela Luvi.`}
      />

      <section aria-labelledby="pendentes" className="mb-8">
        <h2 id="pendentes" className="mb-3 flex items-center gap-2 font-heading text-lg font-bold text-white">
          <Clock className="size-5 text-warning" aria-hidden /> Aguardando sua aprovação
          <Badge variant="secondary">{pending.length}</Badge>
        </h2>
        {pending.length === 0 ? (
          <Card>
            <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-success" aria-hidden /> Tudo em dia! Nenhum material pendente.
            </CardContent>
          </Card>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {pending.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/portal/materiais/${m.id}`}
                  className="group block rounded-2xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <Card className="transition-colors group-hover:border-primary/50">
                    <CardContent className="flex flex-col gap-3">
                      <div className="flex items-center gap-2">
                        <TypeBadge type={m.type} />
                        <span className="text-xs text-muted-foreground">{m.channel}</span>
                      </div>
                      <p className="font-heading text-base font-bold text-white">{m.title}</p>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Prazo: {formatDate(m.dueDate)}</span>
                        <span className="inline-flex items-center gap-1 font-semibold text-primary">
                          Revisar <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="projetos">
        <h2 id="projetos" className="mb-3 font-heading text-lg font-bold text-white">
          Seus projetos
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {myProjects.map((p) => {
            const items = myMaterials.filter((m) => m.projectId === p.id);
            const approved = items.filter((m) => m.status === "aprovado").length;
            const percent = items.length ? Math.round((approved / items.length) * 100) : 0;
            return (
              <Card key={p.id}>
                <CardHeader>
                  <CardTitle>{p.name}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p className="text-sm text-muted-foreground">{p.description}</p>
                  <Progress value={percent} aria-label={`Progresso de aprovação: ${percent}%`} />
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      {approved} de {items.length} materiais aprovados
                    </span>
                    <span>Entrega {formatDate(p.dueDate)}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {items.map((m) => (
                      <Link key={m.id} href={`/portal/materiais/${m.id}`} aria-label={`${m.title}: ${m.status}`}>
                        <StatusBadge status={m.status} className="hover:border-white/40" />
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </>
  );
}
