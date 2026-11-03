import type { Metadata } from "next";
import { Suspense } from "react";
import { MaterialFilters } from "@/components/materials/material-filters";
import { MaterialFormDialog } from "@/components/materials/material-form-dialog";
import { MaterialsList, MaterialsPagination } from "@/components/materials/materials-list";
import { MaterialsTable } from "@/components/materials-table";
import { PageHeader } from "@/components/page-header";
import { ListSkeleton } from "@/components/page-skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { requireStaff } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/env";
import { clients, materials } from "@/lib/mock/data";
import { listClientOptions, listMaterialProjectOptions, listMaterials } from "@/lib/materials/queries";
import { parseMaterialFilters } from "@/lib/materials/schema";

export const metadata: Metadata = { title: "Materiais" };

export default function AdminMaterialsPage({ searchParams }: PageProps<"/admin/materiais">) {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <MaterialsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function MaterialsContent({ searchParams }: { searchParams: PageProps<"/admin/materiais">["searchParams"] }) {
  await requireStaff();

  // Demonstração: os dados fictícios da Fase 1, como sempre. Nada fictício aparece fora dela.
  if (isDemoMode()) {
    return (
      <>
        <PageHeader title="Materiais" description="Artes, carrosséis, vídeos e PDFs enviados para aprovação." />
        <Card>
          <CardContent>
            <MaterialsTable materials={materials} clients={clients} detailBase="/admin/materiais" />
          </CardContent>
        </Card>
      </>
    );
  }

  const filters = parseMaterialFilters(await searchParams);
  const [result, clientOptions, projectOptions] = await Promise.all([
    listMaterials(filters),
    listClientOptions(),
    listMaterialProjectOptions(),
  ]);
  const filtered =
    !!filters.q || filters.status !== "todos" || filters.type !== "todos" || !!filters.clientId || !!filters.projectId;
  const formProjects = projectOptions.filter((p) => p.status !== "concluido");

  return (
    <>
      <PageHeader
        title="Materiais"
        description="Cadastro das artes, carrosséis, vídeos e PDFs de cada projeto."
        actions={
          <MaterialFormDialog
            mode="create"
            clients={clientOptions.filter((c) => c.active)}
            projects={formProjects}
            defaultClientId={filters.clientId ?? undefined}
            defaultProjectId={filters.projectId ?? undefined}
          />
        }
      />
      <MaterialFilters
        filters={filters}
        clients={clientOptions}
        projects={projectOptions}
        summary={`${result.total} ${result.total === 1 ? "material" : "materiais"}`}
      />
      <MaterialsList items={result.items} filtered={filtered} />
      <MaterialsPagination filters={filters} page={result.page} pageCount={result.pageCount} />
    </>
  );
}
