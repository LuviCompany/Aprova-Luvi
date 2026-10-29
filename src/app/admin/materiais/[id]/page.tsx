import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { MaterialReview } from "@/components/material-review";
import { PageHeader } from "@/components/page-header";
import { clientById, projectById } from "@/lib/domain";
import { clients, comments, decisions, materials, projects } from "@/lib/mock/data";

export const metadata: Metadata = { title: "Material" };

export default async function AdminMaterialPage({ params }: PageProps<"/admin/materiais/[id]">) {
  const { id } = await params;
  const material = materials.find((m) => m.id === id);
  if (!material) notFound();
  const client = clientById(material.clientId, clients)!;
  const project = projectById(material.projectId, projects)!;

  return (
    <>
      <Link
        href="/admin/materiais"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-white"
      >
        <ChevronLeft className="size-4" aria-hidden /> Materiais
      </Link>
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
