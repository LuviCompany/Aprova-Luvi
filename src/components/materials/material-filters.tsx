import Link from "next/link";
import { Search } from "lucide-react";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { STATUS_LABEL, TYPE_LABEL } from "@/lib/domain";
import { MATERIAL_STATUSES, MATERIAL_TYPES, type MaterialFilters as Filters } from "@/lib/materials/schema";

interface MaterialFiltersProps {
  filters: Filters;
  clients: Array<{ id: string; name: string; active: boolean }>;
  projects: Array<{ id: string; clientId: string; name: string }>;
  summary: string;
}

/** Filtros por URL (GET): funcionam sem JavaScript e podem ser compartilhados. Mudar o filtro volta à página 1. */
export function MaterialFilters({ filters, clients, projects, summary }: MaterialFiltersProps) {
  const active =
    !!filters.q || filters.status !== "todos" || filters.type !== "todos" || !!filters.clientId || !!filters.projectId;
  const visibleProjects = filters.clientId ? projects.filter((p) => p.clientId === filters.clientId) : projects;
  return (
    <form
      // Campos não controlados ignoram mudanças de defaultValue: remonta o formulário quando os filtros da URL mudam
      // (por exemplo, ao clicar em "Limpar"), senão os campos continuam mostrando o filtro antigo.
      key={JSON.stringify(filters)}
      method="get"
      action="/admin/materiais"
      role="search"
      className="mb-6 flex flex-col gap-3"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-4">
          <Label htmlFor="filtro-busca">Buscar por título</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="filtro-busca" name="q" type="search" defaultValue={filters.q} maxLength={80} className="pl-9" />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filtro-cliente">Cliente</Label>
          <NativeSelect id="filtro-cliente" name="cliente" defaultValue={filters.clientId ?? ""}>
            <option value="">Todos os clientes</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.active ? c.name : `${c.name} (arquivado)`}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filtro-projeto">Projeto</Label>
          <NativeSelect id="filtro-projeto" name="projeto" defaultValue={filters.projectId ?? ""}>
            <option value="">Todos os projetos</option>
            {visibleProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filtro-status">Status</Label>
          <NativeSelect id="filtro-status" name="status" defaultValue={filters.status}>
            <option value="todos">Todos os status</option>
            {MATERIAL_STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABEL[value]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filtro-tipo">Tipo</Label>
          <NativeSelect id="filtro-tipo" name="tipo" defaultValue={filters.type}>
            <option value="todos">Todos os tipos</option>
            {MATERIAL_TYPES.map((value) => (
              <option key={value} value={value}>
                {TYPE_LABEL[value]}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
        {active && (
          <Link href="/admin/materiais" className="text-sm text-muted-foreground underline underline-offset-4 hover:text-white">
            Limpar
          </Link>
        )}
        <p className="ml-auto text-xs text-muted-foreground" aria-live="polite">
          {summary}
        </p>
      </div>
    </form>
  );
}
