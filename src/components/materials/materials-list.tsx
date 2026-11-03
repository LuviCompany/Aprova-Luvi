import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { StatusBadge, TypeBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import type { MaterialListItem } from "@/lib/materials/queries";
import { ASPECT_RATIO_LABEL, type MaterialFilters } from "@/lib/materials/schema";

interface MaterialsListProps {
  items: MaterialListItem[];
  filtered: boolean;
}

/** Tabela de materiais (leitura do banco). Rola dentro do próprio contêiner no celular. */
export function MaterialsList({ items, filtered }: MaterialsListProps) {
  if (items.length === 0) {
    return (
      <p role="status" className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-muted-foreground">
        {filtered
          ? "Nenhum material encontrado com esses filtros."
          : "Nenhum material cadastrado ainda. Use “Novo material” para começar."}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Material</TableHead>
            <TableHead>Cliente · Projeto</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Prazo</TableHead>
            <TableHead>Publicação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((m) => (
            <TableRow key={m.id}>
              <TableCell className="max-w-72 font-medium">
                <Link
                  href={`/admin/materiais/${m.id}`}
                  className="text-white underline-offset-4 hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {m.title}
                </Link>
                {(m.channel || m.aspectRatio) && (
                  <p className="mt-0.5 truncate text-xs font-normal text-muted-foreground">
                    {[m.channel, m.aspectRatio ? ASPECT_RATIO_LABEL[m.aspectRatio] : ""].filter(Boolean).join(" · ")}
                  </p>
                )}
              </TableCell>
              <TableCell className="max-w-64">
                <span className="block truncate">{m.clientName}</span>
                <span className="block truncate text-xs text-muted-foreground">{m.projectName}</span>
              </TableCell>
              <TableCell>
                <TypeBadge type={m.type} />
              </TableCell>
              <TableCell>
                <StatusBadge status={m.status} />
              </TableCell>
              <TableCell className="whitespace-nowrap">{m.dueDate ? formatDate(m.dueDate) : "—"}</TableCell>
              <TableCell className="whitespace-nowrap">{m.publishDate ? formatDate(m.publishDate) : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Querystring dos filtros atuais + a página pedida (sem parâmetros vazios). */
export function pageHref(filters: MaterialFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.clientId) params.set("cliente", filters.clientId);
  if (filters.projectId) params.set("projeto", filters.projectId);
  if (filters.status !== "todos") params.set("status", filters.status);
  if (filters.type !== "todos") params.set("tipo", filters.type);
  if (page > 1) params.set("pagina", String(page));
  const query = params.toString();
  return query ? `/admin/materiais?${query}` : "/admin/materiais";
}

export function MaterialsPagination({ filters, page, pageCount }: { filters: MaterialFilters; page: number; pageCount: number }) {
  if (pageCount <= 1) return null;
  const linkClass =
    "inline-flex items-center gap-1 rounded-full border border-white/10 px-3 py-1.5 text-sm text-white hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
  return (
    <nav aria-label="Paginação de materiais" className="mt-4 flex items-center justify-between gap-3">
      {page > 1 ? (
        <Link href={pageHref(filters, page - 1)} className={linkClass} rel="prev">
          <ChevronLeft className="size-4" aria-hidden /> Anterior
        </Link>
      ) : (
        <span />
      )}
      <p className="text-sm text-muted-foreground">
        Página {page} de {pageCount}
      </p>
      {page < pageCount ? (
        <Link href={pageHref(filters, page + 1)} className={linkClass} rel="next">
          Próxima <ChevronRight className="size-4" aria-hidden />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
