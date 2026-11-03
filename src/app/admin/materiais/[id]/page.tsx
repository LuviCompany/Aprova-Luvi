import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChevronLeft } from "lucide-react";
import { DeleteMaterialButton } from "@/components/materials/delete-material-button";
import { MaterialFormDialog } from "@/components/materials/material-form-dialog";
import { MaterialReview } from "@/components/material-review";
import { PageHeader } from "@/components/page-header";
import { PageSkeleton } from "@/components/page-skeleton";
import { StatusBadge, TypeBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireStaff } from "@/lib/auth/session";
import { clientById, projectById } from "@/lib/domain";
import { isDemoMode } from "@/lib/env";
import { formatDate } from "@/lib/format";
import { clients, comments, decisions, materials, projects } from "@/lib/mock/data";
import { getMaterial } from "@/lib/materials/queries";
import { ASPECT_RATIO_LABEL, isContentLocked } from "@/lib/materials/schema";

export const metadata: Metadata = { title: "Material" };

export default function AdminMaterialPage({ params }: PageProps<"/admin/materiais/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <MaterialContent params={params} />
    </Suspense>
  );
}

const backLink = (
  <Link
    href="/admin/materiais"
    className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-white"
  >
    <ChevronLeft className="size-4" aria-hidden /> Materiais
  </Link>
);

async function MaterialContent({ params }: { params: PageProps<"/admin/materiais/[id]">["params"] }) {
  await requireStaff();
  const { id } = await params;

  // Demonstração: revisão com os dados fictícios da Fase 1.
  if (isDemoMode()) {
    const material = materials.find((m) => m.id === id);
    if (!material) notFound();
    const client = clientById(material.clientId, clients)!;
    const project = projectById(material.projectId, projects)!;
    return (
      <>
        {backLink}
        <PageHeader title={material.title} description={`${client.name} · ${project.name}`} />
        <MaterialReview
          material={material}
          client={client}
          project={project}
          initialComments={comments.filter((c) => c.materialId === material.id)}
          initialDecisions={decisions.filter((d) => d.materialId === material.id)}
          mode="admin"
          actor={{ name: "Equipe Luvi", role: "luvi" }}
        />
      </>
    );
  }

  // Material de outro cliente e material inexistente respondem igual (a RLS não o mostra).
  const material = await getMaterial(id);
  if (!material) notFound();
  const locked = isContentLocked(material.status);
  const canDelete = material.status === "rascunho" && material.versionCount === 0;

  const facts: Array<[string, string]> = [
    ["Canal", material.channel || "—"],
    ["Proporção", material.aspectRatio ? ASPECT_RATIO_LABEL[material.aspectRatio] : "—"],
    ["Prazo de aprovação", material.dueDate ? formatDate(material.dueDate) : "—"],
    ["Publicação prevista", material.publishDate ? formatDate(material.publishDate) : "—"],
  ];

  return (
    <>
      {backLink}
      <PageHeader
        title={material.title}
        description={`${material.clientName}${material.clientActive ? "" : " (arquivado)"} · ${material.projectName}`}
        actions={
          <>
            <MaterialFormDialog
              mode="edit"
              material={{
                id: material.id,
                clientName: material.clientName,
                projectName: material.projectName,
                status: material.status,
                type: material.type,
                title: material.title,
                description: material.description,
                caption: material.caption,
                aspectRatio: material.aspectRatio,
                channel: material.channel,
                publishDate: material.publishDate,
                dueDate: material.dueDate,
              }}
            />
            {canDelete && <DeleteMaterialButton materialId={material.id} title={material.title} redirectTo="/admin/materiais" />}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <TypeBadge type={material.type} />
              <StatusBadge status={material.status} />
              {locked && (
                <span className="text-xs text-muted-foreground">
                  Conteúdo travado: só muda numa nova revisão. As datas continuam editáveis.
                </span>
              )}
            </div>
            <section aria-labelledby="legenda">
              <h2 id="legenda" className="mb-1.5 font-heading text-sm font-bold text-white">
                Legenda
              </h2>
              {material.caption ? (
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">{material.caption}</p>
              ) : (
                <p className="text-sm text-muted-foreground">Sem legenda.</p>
              )}
            </section>
            <section aria-labelledby="descricao">
              <h2 id="descricao" className="mb-1.5 font-heading text-sm font-bold text-white">
                Descrição interna
              </h2>
              {material.description ? (
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">{material.description}</p>
              ) : (
                <p className="text-sm text-muted-foreground">Sem descrição.</p>
              )}
            </section>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
                {facts.map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="font-medium break-words text-white">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col gap-1.5 text-sm">
              <h2 className="font-heading text-sm font-bold text-white">Arquivos e versões</h2>
              <p className="text-muted-foreground">
                {material.versionCount === 0
                  ? "Nenhum arquivo ainda. O envio de arquivos e o histórico de versões chegam nas próximas etapas do módulo."
                  : `${material.versionCount} ${material.versionCount === 1 ? "versão" : "versões"} registrada(s).`}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
