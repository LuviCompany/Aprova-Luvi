import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChevronLeft } from "lucide-react";
import { ApprovalPanel } from "@/components/approval/approval-panel";
import { SubmitApprovalDialog } from "@/components/approval/submit-approval-dialog";
import { FileUploader } from "@/components/materials/file-uploader";
import { SlidesPanel } from "@/components/materials/slides-panel";
import { StartRevisionDialog } from "@/components/materials/start-revision-dialog";
import { VersionsHistory } from "@/components/materials/versions-history";
import { DeleteMaterialButton } from "@/components/materials/delete-material-button";
import { MaterialFormDialog } from "@/components/materials/material-form-dialog";
import { MaterialReview } from "@/components/material-review";
import { PageHeader } from "@/components/page-header";
import { PageSkeleton } from "@/components/page-skeleton";
import { StatusBadge, TypeBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { APPROVAL_POLICY_TEXT } from "@/lib/approval/schema";
import { listApproverOptions, listSubmissions } from "@/lib/approval/staff-queries";
import { requireStaff } from "@/lib/auth/session";
import { clientById, projectById } from "@/lib/domain";
import { isDemoMode } from "@/lib/env";
import { formatDate } from "@/lib/format";
import { clients, comments, decisions, materials, projects } from "@/lib/mock/data";
import { getMaterial } from "@/lib/materials/queries";
import { listMaterialVersions } from "@/lib/materials/versions";
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
  const [versions, submissions, approverOptions] = await Promise.all([
    listMaterialVersions(id),
    listSubmissions(id),
    listApproverOptions(material.clientId),
  ]);
  const latest = versions[0];
  // Versão de trabalho: a mais recente que ainda não foi enviada; só com o material em rascunho se mexe nos arquivos.
  const working = material.status === "rascunho" && (!latest || !latest.sent) ? (latest ?? null) : null;
  const canEditFiles = material.status === "rascunho";
  const canRevise = material.status === "alteracao" || material.status === "aprovado";
  // Envio: só rascunho, da versão mais recente (a mesma versão pode ser reenviada depois de um cancelamento, se nada mudou).
  const sendVersion = material.status === "rascunho" && latest && latest.files.length > 0 ? latest : null;
  const sendBlocked = !material.clientActive ? "Cliente arquivado." : !sendVersion ? "Envie ao menos um arquivo para pedir a aprovação." : undefined;

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
            {material.status === "rascunho" && (
              <SubmitApprovalDialog
                versionId={sendVersion?.id ?? ""}
                versionNumber={sendVersion?.number ?? 0}
                approvers={approverOptions}
                blockedReason={sendBlocked}
                suggestedDueDate={material.dueDate}
              />
            )}
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
        </div>
      </div>

      <section aria-labelledby="arquivos" className="mt-6">
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="arquivos" className="font-heading text-base font-bold text-white">
                Arquivos{working ? ` · versão ${working.number}` : latest ? ` · versão ${latest.number}` : ""}
              </h2>
              {canRevise && <StartRevisionDialog materialId={material.id} status={material.status} />}
            </div>
            {canEditFiles ? (
              <>
                {working ? (
                  <SlidesPanel versionId={working.id} type={material.type} files={working.files} editable />
                ) : latest ? (
                  <p className="text-sm text-muted-foreground">
                    A versão {latest.number} já foi enviada para aprovação e ficou no histórico. O próximo envio cria uma nova versão.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">Nenhum arquivo ainda. O primeiro envio cria a versão 1.</p>
                )}
                <FileUploader materialId={material.id} type={material.type} existingCount={working?.files.length ?? 0} />
              </>
            ) : latest ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Os arquivos da versão {latest.number} estão travados porque o material já foi enviado para aprovação.
                  {canRevise ? " Para trocá-los, inicie uma revisão: ela cria uma nova versão e preserva esta." : ""}
                </p>
                <SlidesPanel versionId={latest.id} type={material.type} files={latest.files} editable={false} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Este material não tem arquivos.</p>
            )}
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="aprovacao" className="mt-6">
        <Card>
          <CardContent className="flex flex-col gap-3">
            <div>
              <h2 id="aprovacao" className="font-heading text-base font-bold text-white">
                Aprovação
              </h2>
              <p className="text-xs text-muted-foreground">{APPROVAL_POLICY_TEXT}</p>
            </div>
            <ApprovalPanel submissions={submissions} />
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="versoes" className="mt-6">
        <Card>
          <CardContent className="flex flex-col gap-3">
            <h2 id="versoes" className="font-heading text-base font-bold text-white">
              Histórico de versões
            </h2>
            <VersionsHistory versions={versions} />
          </CardContent>
        </Card>
      </section>
    </>
  );
}
