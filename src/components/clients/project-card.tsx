import { ProjectFormDialog } from "@/components/clients/project-form-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { ProjectListItem } from "@/lib/clients/queries";
import { PROJECT_STATUS_LABEL } from "@/lib/clients/schema";
import { formatDate } from "@/lib/format";

interface ProjectCardProps {
  project: ProjectListItem;
  /** Mostra o botão de editar. Falso na demonstração. */
  canEdit: boolean;
}

export function ProjectCard({ project, canEdit }: ProjectCardProps) {
  const percent = project.materialCount ? Math.round((project.approvedCount / project.materialCount) * 100) : 0;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-heading text-base font-bold text-white">{project.name}</h2>
            <p className="text-sm text-muted-foreground">
              {project.clientName}
              {!project.clientActive && " (cliente arquivado)"}
            </p>
          </div>
          <Badge variant="secondary">{PROJECT_STATUS_LABEL[project.status]}</Badge>
        </div>
        {project.description && <p className="text-sm text-muted-foreground">{project.description}</p>}
        <div>
          <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
            <span>
              {project.approvedCount} de {project.materialCount} aprovados
            </span>
            <span>{project.dueDate ? `Entrega ${formatDate(project.dueDate)}` : "Sem data de entrega"}</span>
          </div>
          <Progress value={percent} aria-label={`Progresso de aprovação: ${percent}%`} />
        </div>
        {canEdit && (
          <div className="flex justify-end border-t border-white/10 pt-3">
            <ProjectFormDialog
              mode="edit"
              project={{
                id: project.id,
                clientName: project.clientName,
                name: project.name,
                description: project.description,
                status: project.status,
                dueDate: project.dueDate,
              }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
