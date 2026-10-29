import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, MessageSquareWarning } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { clientById } from "@/lib/domain";
import { formatDateTime } from "@/lib/format";
import { clients, decisions, materials } from "@/lib/mock/data";

export const metadata: Metadata = { title: "Histórico de aprovações" };

export default function AdminHistoryPage() {
  const rows = [...decisions].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <>
      <PageHeader
        title="Histórico de aprovações"
        description="Registro imutável de cada decisão: quem decidiu, quando, em qual versão e por qual canal."
      />
      <Card>
        <CardContent>
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
                {rows.map((d) => {
                  const material = materials.find((m) => m.id === d.materialId);
                  return (
                    <TableRow key={d.id}>
                      <TableCell className="whitespace-nowrap">{formatDateTime(d.at)}</TableCell>
                      <TableCell className="max-w-64 font-medium">
                        <Link href={`/admin/materiais/${d.materialId}`} className="text-white hover:text-primary hover:underline">
                          {material?.title}
                        </Link>
                        {d.note && <p className="mt-0.5 truncate text-xs font-normal text-muted-foreground">“{d.note}”</p>}
                      </TableCell>
                      <TableCell>{material ? clientById(material.clientId, clients)?.name : "—"}</TableCell>
                      <TableCell>v{d.version}</TableCell>
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
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
