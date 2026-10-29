import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { clientById } from "@/lib/domain";
import { formatDate } from "@/lib/format";
import { clients, materials, projects } from "@/lib/mock/data";
import type { ProjectStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Projetos" };

const PROJECT_STATUS: Record<ProjectStatus, string> = {
  ativo: "Ativo",
  pausado: "Pausado",
  concluido: "Concluído",
};

export default function AdminProjectsPage() {
  return (
    <>
      <PageHeader title="Projetos" description="Campanhas e entregas agrupadas por cliente." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((project) => {
          const items = materials.filter((m) => m.projectId === project.id);
          const approved = items.filter((m) => m.status === "aprovado").length;
          const percent = items.length ? Math.round((approved / items.length) * 100) : 0;
          return (
            <Card key={project.id}>
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="font-heading text-base font-bold text-white">{project.name}</h2>
                    <p className="text-sm text-muted-foreground">{clientById(project.clientId, clients)?.name}</p>
                  </div>
                  <Badge variant="secondary">{PROJECT_STATUS[project.status]}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{project.description}</p>
                <div>
                  <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                    <span>
                      {approved} de {items.length} aprovados
                    </span>
                    <span>Entrega {formatDate(project.dueDate)}</span>
                  </div>
                  <Progress value={percent} aria-label={`Progresso de aprovação: ${percent}%`} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
