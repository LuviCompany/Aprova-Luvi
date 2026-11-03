import type { Metadata } from "next";
import { Suspense } from "react";
import { ListFilters } from "@/components/clients/list-filters";
import { ProjectCard } from "@/components/clients/project-card";
import { ProjectFormDialog } from "@/components/clients/project-form-dialog";
import { PageHeader } from "@/components/page-header";
import { ListSkeleton } from "@/components/page-skeleton";
import { requireStaff } from "@/lib/auth/session";
import { demoClientOptions, demoProjects } from "@/lib/clients/demo";
import { listClientOptions, listProjects } from "@/lib/clients/queries";
import { PROJECT_STATUSES, PROJECT_STATUS_LABEL, parseProjectFilters } from "@/lib/clients/schema";
import { isDemoMode } from "@/lib/env";

export const metadata: Metadata = { title: "Projetos" };

const STATUS_OPTIONS = [
  { value: "todos", label: "Todos" },
  ...PROJECT_STATUSES.map((value) => ({ value, label: PROJECT_STATUS_LABEL[value] })),
];

export default function AdminProjectsPage({ searchParams }: PageProps<"/admin/projetos">) {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <ProjectsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ProjectsContent({ searchParams }: { searchParams: PageProps<"/admin/projetos">["searchParams"] }) {
  await requireStaff();
  const filters = parseProjectFilters(await searchParams);
  const demo = isDemoMode();
  const [items, clients] = demo
    ? [demoProjects(filters), demoClientOptions()]
    : await Promise.all([listProjects(filters), listClientOptions()]);
  const filtered = !!filters.q || filters.status !== "todos" || !!filters.clientId;

  return (
    <>
      <PageHeader
        title="Projetos"
        description="Campanhas e entregas agrupadas por cliente."
        actions={!demo ? <ProjectFormDialog mode="create" clients={clients.filter((c) => c.active)} /> : undefined}
      />
      <ListFilters
        action="/admin/projetos"
        q={filters.q}
        status={{ value: filters.status, options: STATUS_OPTIONS }}
        client={{
          value: filters.clientId ?? "",
          options: [
            { value: "", label: "Todos os clientes" },
            ...clients.map((c) => ({ value: c.id, label: c.active ? c.name : `${c.name} (arquivado)` })),
          ],
        }}
        summary={`${items.length} ${items.length === 1 ? "projeto" : "projetos"}`}
      />
      {items.length === 0 ? (
        <p role="status" className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-muted-foreground">
          {filtered
            ? "Nenhum projeto encontrado com esses filtros."
            : "Nenhum projeto cadastrado ainda. Use “Novo projeto” para começar."}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((project) => (
            <ProjectCard key={project.id} project={project} canEdit={!demo} />
          ))}
        </div>
      )}
    </>
  );
}
