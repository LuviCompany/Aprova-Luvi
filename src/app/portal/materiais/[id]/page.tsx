import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChevronLeft } from "lucide-react";
import { ReviewScreen } from "@/components/approval/review-screen";
import { MaterialReview } from "@/components/material-review";
import { PageHeader } from "@/components/page-header";
import { PageSkeleton } from "@/components/page-skeleton";
import { addCommentAction, decideAction } from "@/app/portal/review-actions";
import { getPortalMaterial } from "@/lib/approval/portal-queries";
import { resolvePortalContext } from "@/lib/auth/portal-context";
import { requireClientUser } from "@/lib/auth/session";
import { clientById, projectById } from "@/lib/domain";
import { isDemoMode } from "@/lib/env";
import {
  CURRENT_PORTAL_APPROVER_ID,
  CURRENT_PORTAL_CLIENT_ID,
  clients,
  comments,
  decisions,
  materials,
  projects,
} from "@/lib/mock/data";
import type { PortalBucket } from "@/lib/approval/portal-queries";

export const metadata: Metadata = { title: "Revisar material" };

const backLink = (
  <Link href="/portal/materiais" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-white">
    <ChevronLeft className="size-4" aria-hidden /> Materiais
  </Link>
);

const IDLE: Record<PortalBucket, string> = {
  pendente: "",
  aguardando_outros: "Você já respondeu. Aguardando os outros aprovadores deste material.",
  ajustes: "Este material está em ajustes: a equipe da Luvi vai enviar uma nova versão para você.",
  aprovado: "Este material está aprovado. Nenhuma ação é necessária.",
};

export default function PortalMaterialPage({ params }: PageProps<"/portal/materiais/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <MaterialContent params={params} />
    </Suspense>
  );
}

async function MaterialContent({ params }: { params: PageProps<"/portal/materiais/[id]">["params"] }) {
  const user = await requireClientUser();
  const { id } = await params;

  if (isDemoMode()) {
    const material = materials.find((m) => m.id === id);
    // Material de outro cliente responde 404, igual a um material inexistente (não vaza existência).
    if (!material || material.clientId !== CURRENT_PORTAL_CLIENT_ID) notFound();
    const client = clientById(material.clientId, clients)!;
    const project = projectById(material.projectId, projects)!;
    const approver = client.approvers.find((a) => a.id === CURRENT_PORTAL_APPROVER_ID)!;
    return (
      <>
        {backLink}
        <PageHeader title={material.title} description={project.name} />
        <MaterialReview
          material={material}
          client={client}
          project={project}
          initialComments={comments.filter((c) => c.materialId === material.id)}
          initialDecisions={decisions.filter((d) => d.materialId === material.id)}
          mode="portal"
          actor={{ name: approver.name, role: "cliente" }}
        />
      </>
    );
  }

  const resolution = await resolvePortalContext(user);
  if (resolution.kind !== "ok") notFound();
  // Material de outra empresa, inexistente ou ainda não enviado: a RLS responde igual (404).
  const detail = await getPortalMaterial(id, resolution.context);
  if (!detail) notFound();

  return (
    <>
      {backLink}
      <PageHeader title={detail.review.content.title} description={`${resolution.context.clientName} · ${detail.projectName}`} />
      <ReviewScreen
        review={detail.review}
        status={detail.status}
        fileBase="/portal/arquivos"
        canDecide={Boolean(detail.myRequestId)}
        idleNotice={IDLE[detail.bucket]}
        approverName={user.name}
        onDecide={decideAction.bind(null, detail.myRequestId ?? "")}
        onComment={addCommentAction.bind(null, detail.id, detail.versionId)}
      />
    </>
  );
}
