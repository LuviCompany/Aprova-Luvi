import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, MessageSquareWarning } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { CURRENT_PORTAL_CLIENT_ID, decisions, materials } from "@/lib/mock/data";

export const metadata: Metadata = { title: "Histórico" };

export default function PortalHistoryPage() {
  const mine = decisions
    .filter((d) => materials.find((m) => m.id === d.materialId)?.clientId === CURRENT_PORTAL_CLIENT_ID)
    .sort((a, b) => b.at.localeCompare(a.at));

  return (
    <>
      <PageHeader title="Histórico" description="Todas as decisões registradas para os seus materiais." />
      <Card>
        <CardContent>
          {mine.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma decisão registrada ainda.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-white/10">
              {mine.map((d) => {
                const material = materials.find((m) => m.id === d.materialId)!;
                return (
                  <li key={d.id} className="flex items-start gap-3 py-4 first:pt-0 last:pb-0">
                    {d.decision === "aprovado" ? (
                      <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
                    ) : (
                      <MessageSquareWarning className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                    )}
                    <div className="min-w-0 text-sm">
                      <p className="text-white">
                        {d.decision === "aprovado" ? "Aprovado" : "Alteração solicitada"} ·{" "}
                        <Link href={`/portal/materiais/${material.id}`} className="underline-offset-4 hover:text-primary hover:underline">
                          {material.title}
                        </Link>{" "}
                        <span className="text-muted-foreground">(v{d.version})</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {d.by} · {formatDateTime(d.at)} · {d.via === "link" ? "link seguro" : "portal"}
                      </p>
                      {d.note && <p className="mt-1 text-muted-foreground">“{d.note}”</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>
    </>
  );
}
