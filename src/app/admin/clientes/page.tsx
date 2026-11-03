import type { Metadata } from "next";
import { Suspense } from "react";
import { ClientCard } from "@/components/clients/client-card";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { ListFilters } from "@/components/clients/list-filters";
import { PageHeader } from "@/components/page-header";
import { ListSkeleton } from "@/components/page-skeleton";
import { canManageClients } from "@/lib/auth/roles";
import { requireStaff } from "@/lib/auth/session";
import { demoClients } from "@/lib/clients/demo";
import { listClients } from "@/lib/clients/queries";
import { parseClientFilters } from "@/lib/clients/schema";
import { isDemoMode } from "@/lib/env";

export const metadata: Metadata = { title: "Clientes" };

const STATUS_OPTIONS = [
  { value: "ativos", label: "Ativos" },
  { value: "arquivados", label: "Arquivados" },
  { value: "todos", label: "Todos" },
];

export default function AdminClientsPage({ searchParams }: PageProps<"/admin/clientes">) {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <ClientsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ClientsContent({ searchParams }: { searchParams: PageProps<"/admin/clientes">["searchParams"] }) {
  // Papel e modo (demonstração/real) são decididos a cada requisição, no servidor.
  const user = await requireStaff();
  const filters = parseClientFilters(await searchParams);
  const demo = isDemoMode();
  const items = demo ? demoClients(filters) : await listClients(filters);
  const canManage = !demo && canManageClients(user.role);
  const filtered = !!filters.q || filters.status !== "ativos";

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Empresas atendidas e seus aprovadores. Cada cliente enxerga apenas os próprios materiais."
        actions={canManage ? <ClientFormDialog mode="create" /> : undefined}
      />
      <ListFilters
        action="/admin/clientes"
        q={filters.q}
        status={{ value: filters.status, options: STATUS_OPTIONS }}
        summary={`${items.length} ${items.length === 1 ? "cliente" : "clientes"}`}
      />
      {items.length === 0 ? (
        <p role="status" className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-muted-foreground">
          {filtered
            ? "Nenhum cliente encontrado com esses filtros."
            : canManage
              ? "Nenhum cliente cadastrado ainda. Use “Novo cliente” para começar."
              : "Nenhum cliente cadastrado ainda."}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((client) => (
            <ClientCard key={client.id} client={client} canManage={canManage} />
          ))}
        </div>
      )}
      {!demo && !canManage && (
        <p className="mt-6 text-xs text-muted-foreground">
          Seu perfil pode consultar os clientes. O cadastro e a edição são do Atendimento e da administração.
        </p>
      )}
    </>
  );
}
