"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { AlertTriangle, Search } from "lucide-react";
import { NativeSelect } from "@/components/native-select";
import { StatusBadge, TypeBadge } from "@/components/status-badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { STATUS_LABEL, TYPE_LABEL, filterMaterials, isOverdue, type MaterialFilters } from "@/lib/domain";
import { formatDate } from "@/lib/format";
import { NOW } from "@/lib/mock/data";
import type { Client, Material, MaterialStatus, MaterialType } from "@/lib/types";

interface MaterialsTableProps {
  materials: Material[];
  clients: Client[];
  /** Prefixo da rota de detalhe, ex.: "/admin/materiais". */
  detailBase: string;
  showClientFilter?: boolean;
  initialStatus?: MaterialFilters["status"];
}

export function MaterialsTable({
  materials,
  clients,
  detailBase,
  showClientFilter = true,
  initialStatus = "todos",
}: MaterialsTableProps) {
  const id = useId();
  const [clientId, setClientId] = useState("todos");
  const [status, setStatus] = useState<MaterialFilters["status"]>(initialStatus);
  const [type, setType] = useState<MaterialFilters["type"]>("todos");
  const [search, setSearch] = useState("");

  const rows = useMemo(
    () => filterMaterials(materials, { clientId, status, type, search }),
    [materials, clientId, status, type, search],
  );
  const clientName = (cid: string) => clients.find((c) => c.id === cid)?.name ?? "—";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-search`}>Buscar</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id={`${id}-search`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Título do material"
              className="h-9 pl-9"
            />
          </div>
        </div>
        {showClientFilter && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-client`}>Cliente</Label>
            <NativeSelect id={`${id}-client`} value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="todos">Todos os clientes</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-status`}>Status</Label>
          <NativeSelect
            id={`${id}-status`}
            value={status}
            onChange={(e) => setStatus(e.target.value as MaterialStatus | "todos")}
          >
            <option value="todos">Todos os status</option>
            {(Object.keys(STATUS_LABEL) as MaterialStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-type`}>Tipo</Label>
          <NativeSelect
            id={`${id}-type`}
            value={type}
            onChange={(e) => setType(e.target.value as MaterialType | "todos")}
          >
            <option value="todos">Todos os tipos</option>
            {(Object.keys(TYPE_LABEL) as MaterialType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {rows.length} {rows.length === 1 ? "material" : "materiais"}
      </p>

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Material</TableHead>
              {showClientFilter && <TableHead>Cliente</TableHead>}
              <TableHead>Tipo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Versão</TableHead>
              <TableHead>Prazo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={showClientFilter ? 6 : 5} className="py-10 text-center text-muted-foreground">
                  Nenhum material encontrado com esses filtros.
                </TableCell>
              </TableRow>
            )}
            {rows.map((m) => {
              const overdue = isOverdue(m, NOW);
              return (
                <TableRow key={m.id}>
                  <TableCell className="max-w-72 font-medium">
                    <Link
                      href={`${detailBase}/${m.id}`}
                      className="text-white underline-offset-4 hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {m.title}
                    </Link>
                  </TableCell>
                  {showClientFilter && <TableCell>{clientName(m.clientId)}</TableCell>}
                  <TableCell>
                    <TypeBadge type={m.type} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={m.status} />
                  </TableCell>
                  <TableCell>v{m.versions[m.versions.length - 1].number}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {overdue ? (
                      <span className="inline-flex items-center gap-1 font-medium text-destructive">
                        <AlertTriangle className="size-3.5" aria-hidden />
                        {formatDate(m.dueDate)} · atrasado
                      </span>
                    ) : (
                      formatDate(m.dueDate)
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
