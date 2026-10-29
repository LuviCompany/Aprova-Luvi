import type { Metadata } from "next";
import { MaterialsTable } from "@/components/materials-table";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { CURRENT_PORTAL_CLIENT_ID, clients, materials } from "@/lib/mock/data";

export const metadata: Metadata = { title: "Materiais" };

export default function PortalMaterialsPage() {
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
