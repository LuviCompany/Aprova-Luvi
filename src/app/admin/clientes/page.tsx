import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { clients, materials, projects } from "@/lib/mock/data";

export const metadata: Metadata = { title: "Clientes" };

export default function AdminClientsPage() {
  return (
    <>
      <PageHeader
        title="Clientes"
        description="Empresas atendidas e seus aprovadores. Cada cliente enxerga apenas os próprios materiais."
      />
      <div className="grid gap-4 md:grid-cols-2">
        {clients.map((client) => {
          const clientProjects = projects.filter((p) => p.clientId === client.id);
          const pending = materials.filter((m) => m.clientId === client.id && m.status === "aguardando").length;
          return (
            <Card key={client.id}>
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <Avatar className="size-11">
                    <AvatarFallback className="bg-primary/15 font-heading font-bold text-primary">
                      {client.initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <h2 className="truncate font-heading text-lg font-bold text-white">{client.name}</h2>
                    <p className="text-sm text-muted-foreground">{client.segment}</p>
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Projetos</dt>
                    <dd className="font-semibold text-white">{clientProjects.length}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Aguardando aprovação</dt>
                    <dd className="font-semibold text-white">{pending}</dd>
                  </div>
                </dl>
                <div>
                  <p className="mb-1.5 text-xs text-muted-foreground">Aprovadores</p>
                  <ul className="flex flex-col gap-1 text-sm">
                    {client.approvers.map((a) => (
                      <li key={a.id} className="flex flex-wrap justify-between gap-x-3">
                        <span className="text-white">
                          {a.name} <span className="text-muted-foreground">· {a.role}</span>
                        </span>
                        <span className="text-muted-foreground">{a.email}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
