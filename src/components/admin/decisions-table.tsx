import Link from "next/link";
import { CheckCircle2, MessageSquareWarning } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";

/** Tabela do histórico de aprovações da equipe. Recebe linhas já prontas: serve ao banco real e à demonstração. */

export interface DecisionRow {
  id: string;
  materialId: string;
  materialTitle: string;
  clientName: string;
  versionNumber: number;
  decision: "aprovado" | "alteracao";
  via: "portal" | "link";
  by: string;
  at: string;
  note: string;
}

export function DecisionsTable({ rows }: { rows: DecisionRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Data</TableHead>
            <TableHead>Material</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead>Versão</TableHead>
            <TableHead>Decisão</TableHead>
            <TableHead>Por</TableHead>
            <TableHead>Canal</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((d) => (
            <TableRow key={d.id}>
              <TableCell className="whitespace-nowrap">{formatDateTime(d.at)}</TableCell>
              <TableCell className="max-w-64 font-medium">
                <Link href={`/admin/materiais/${d.materialId}`} className="text-white hover:text-primary hover:underline">
                  {d.materialTitle}
                </Link>
                {d.note && <p className="mt-0.5 truncate text-xs font-normal text-muted-foreground">“{d.note}”</p>}
              </TableCell>
              <TableCell>{d.clientName}</TableCell>
              <TableCell>v{d.versionNumber}</TableCell>
              <TableCell>
                {d.decision === "aprovado" ? (
                  <span className="inline-flex items-center gap-1 text-success">
                    <CheckCircle2 className="size-3.5" aria-hidden /> Aprovado
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-primary">
                    <MessageSquareWarning className="size-3.5" aria-hidden /> Alteração
                  </span>
                )}
              </TableCell>
              <TableCell>{d.by}</TableCell>
              <TableCell>{d.via === "link" ? "Link seguro" : "Portal"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
