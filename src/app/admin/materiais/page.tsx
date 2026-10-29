import type { Metadata } from "next";
import { MaterialsTable } from "@/components/materials-table";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { clients, materials } from "@/lib/mock/data";

export const metadata: Metadata = { title: "Materiais" };

export default function AdminMaterialsPage() {
  return (
    <>
      <PageHeader title="Materiais" description="Artes, carrosséis, vídeos e PDFs enviados para aprovação." />
      <Card>
        <CardContent>
          <MaterialsTable materials={materials} clients={clients} detailBase="/admin/materiais" />
        </CardContent>
      </Card>
    </>
  );
}
