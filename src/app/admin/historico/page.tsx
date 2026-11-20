import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckCheck } from "lucide-react";
import { DecisionsTable, type DecisionRow } from "@/components/admin/decisions-table";
import { EmptyState, LoadErrorState } from "@/components/admin/data-states";
import { PageHeader } from "@/components/page-header";
import { ListSkeleton } from "@/components/page-skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { STAFF_HISTORY_LIMIT, listStaffDecisions } from "@/lib/approval/staff-history";
import { requireStaff } from "@/lib/auth/session";
import { DataLoadError } from "@/lib/clients/queries";
import { clientById } from "@/lib/domain";
import { isDemoMode } from "@/lib/env";
import { clients, decisions, materials } from "@/lib/mock/data";

export const metadata: Metadata = { title: "Histórico de aprovações" };

const DESCRIPTION = "Registro imutável de cada decisão: quem decidiu, quando, em qual versão e por qual canal.";

export default function AdminHistoryPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <HistoryContent />
    </Suspense>
  );
}

async function HistoryContent() {
  await requireStaff();

  // Demonstração: os dados fictícios da Fase 1. Fora dela, nada fictício aparece.
  if (isDemoMode()) return <HistoryDemo />;

  let result: Awaited<ReturnType<typeof listStaffDecisions>>;
  try {
    result = await listStaffDecisions();
  } catch (error) {
    if (!(error instanceof DataLoadError)) throw error;
    return (
      <>
        <PageHeader title="Histórico de aprovações" description={DESCRIPTION} />
        <LoadErrorState what="o histórico de aprovações" />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Histórico de aprovações" description={DESCRIPTION} />
      {result.items.length === 0 ? (
        <EmptyState icon={CheckCheck} title="Nenhuma decisão registrada ainda">
          Quando um aprovador aprovar ou pedir alteração de um material, a decisão aparece aqui, com quem decidiu, a versão e o canal.
        </EmptyState>
      ) : (
        <Card>
          <CardContent>
            <DecisionsTable rows={result.items} />
            {result.truncated && (
              <p className="mt-3 text-xs text-muted-foreground">Mostrando as {STAFF_HISTORY_LIMIT} decisões mais recentes.</p>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}

/** Demonstração: decisões fictícias de src/lib/mock, no mesmo formato da tabela real. */
function HistoryDemo() {
  const rows: DecisionRow[] = [...decisions]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((d) => {
      const material = materials.find((m) => m.id === d.materialId);
      return {
        id: d.id,
        materialId: d.materialId,
        materialTitle: material?.title ?? "—",
        clientName: material ? (clientById(material.clientId, clients)?.name ?? "—") : "—",
        versionNumber: d.version,
        decision: d.decision,
        via: d.via,
        by: d.by,
        at: d.at,
        note: d.note ?? "",
      };
    });
  return (
    <>
      <PageHeader title="Histórico de aprovações" description={DESCRIPTION} />
      <Card>
        <CardContent>
          <DecisionsTable rows={rows} />
        </CardContent>
      </Card>
    </>
  );
}
