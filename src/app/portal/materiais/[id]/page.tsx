import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { MaterialReview } from "@/components/material-review";
import { PageHeader } from "@/components/page-header";
import { clientById, projectById } from "@/lib/domain";
import {
  CURRENT_PORTAL_APPROVER_ID,
  CURRENT_PORTAL_CLIENT_ID,
  clients,
  comments,
  decisions,
  materials,
  projects,
} from "@/lib/mock/data";

export const metadata: Metadata = { title: "Revisar material" };

export default async function PortalMaterialPage({ params }: PageProps<"/portal/materiais/[id]">) {
  const { id } = await params;
  const material = materials.find((m) => m.id === id);
  // Material de outro cliente responde 404, igual a um material inexistente (não vaza existência).
  if (!material || material.clientId !== CURRENT_PORTAL_CLIENT_ID) notFound();
  const client = clientById(material.clientId, clients)!;
  const project = projectById(material.projectId, projects)!;
  const approver = client.approvers.find((a) => a.id === CURRENT_PORTAL_APPROVER_ID)!;

  return (
    <>
      <Link
        href="/portal/materiais"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-white"
      >
        <ChevronLeft className="size-4" aria-hidden /> Materiais
      </Link>
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
