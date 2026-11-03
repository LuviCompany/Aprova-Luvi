import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { MaterialsTable } from "@/components/materials-table";
import { PageHeader } from "@/components/page-header";
import { ListSkeleton } from "@/components/page-skeleton";
import { BUCKET_LABEL, PortalMaterialGroups, bucketCounts } from "@/components/portal/portal-materials";
import { Card, CardContent } from "@/components/ui/card";
import { listPortalMaterials, type PortalBucket } from "@/lib/approval/portal-queries";
import { resolvePortalContext } from "@/lib/auth/portal-context";
import { requireClientUser } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/env";
import { CURRENT_PORTAL_CLIENT_ID, clients, materials } from "@/lib/mock/data";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Materiais" };

const FILTERS: PortalBucket[] = ["pendente", "aguardando_outros", "ajustes", "aprovado"];

export default function PortalMaterialsPage({ searchParams }: PageProps<"/portal/materiais">) {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <MaterialsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function MaterialsContent({ searchParams }: { searchParams: PageProps<"/portal/materiais">["searchParams"] }) {
  const user = await requireClientUser();
  if (isDemoMode()) {
    const mine = materials.filter((m) => m.clientId === CURRENT_PORTAL_CLIENT_ID);
    return (
      <>
        <PageHeader title="Materiais" description="Todos os materiais enviados pela Luvi para a sua empresa." />
        <Card>
          <CardContent>
            <MaterialsTable materials={mine} clients={clients} detailBase="/portal/materiais" showClientFilter={false} />
          </CardContent>
        </Card>
      </>
    );
  }

  const resolution = await resolvePortalContext(user);
  if (resolution.kind !== "ok") return null;
  const items = await listPortalMaterials(resolution.context);
  const raw = (await searchParams).filtro;
  const only = FILTERS.find((f) => f === (Array.isArray(raw) ? raw[0] : raw));
  const counts = bucketCounts(items);

  return (
    <>
      <PageHeader title="Materiais" description="Todos os materiais enviados pela Luvi para a sua empresa." />
      <nav aria-label="Filtrar por situação" className="mb-6 flex flex-wrap gap-2">
        {[undefined, ...FILTERS].map((filter) => (
          <Link
            key={filter ?? "todos"}
            href={filter ? `/portal/materiais?filtro=${filter}` : "/portal/materiais"}
            aria-current={filter === only ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              filter === only ? "border-primary bg-primary/15 text-primary" : "border-white/10 text-muted-foreground hover:text-white",
            )}
          >
            {filter ? `${BUCKET_LABEL[filter]} (${counts[filter]})` : `Todos (${items.length})`}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? (
        <Card>
          <CardContent className="text-sm text-muted-foreground">Nenhum material enviado para a sua aprovação ainda.</CardContent>
        </Card>
      ) : (
        <PortalMaterialGroups items={items} only={only} />
      )}
    </>
  );
}
