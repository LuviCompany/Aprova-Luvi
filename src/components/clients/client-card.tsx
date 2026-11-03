import Link from "next/link";
import { ArchiveClientButton } from "@/components/clients/archive-client-button";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { ClientListItem } from "@/lib/clients/queries";

interface ClientCardProps {
  client: ClientListItem;
  /** Mostra editar/arquivar. Falso para o designer e na demonstração. */
  canManage: boolean;
}

export function ClientCard({ client, canManage }: ClientCardProps) {
  const approvers = client.approvers.filter((a) => a.active);
  return (
    <Card className={client.active ? undefined : "opacity-80"}>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Avatar className="size-11">
            <AvatarFallback className="bg-primary/15 font-heading font-bold text-primary">
              {client.initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-heading text-lg font-bold text-white">
              <Link href={`/admin/clientes/${client.id}`} className="hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                {client.name}
              </Link>
            </h2>
            <p className="truncate text-sm text-muted-foreground">{client.segment || "Segmento não informado"}</p>
          </div>
          {!client.active && <Badge variant="secondary">Arquivado</Badge>}
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Projetos</dt>
            <dd className="font-semibold text-white">{client.projectCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Aguardando aprovação</dt>
            <dd className="font-semibold text-white">{client.pendingCount}</dd>
          </div>
        </dl>
        <div>
          <p className="mb-1.5 text-xs text-muted-foreground">Aprovadores</p>
          {approvers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum aprovador cadastrado.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {approvers.map((a) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-x-3">
                  <span className="text-white">
                    {a.name}
                    {a.jobTitle && <span className="text-muted-foreground"> · {a.jobTitle}</span>}
                  </span>
                  <span className="text-muted-foreground">{a.email}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
          <Link
            href={`/admin/clientes/${client.id}`}
            className="text-sm font-semibold text-primary underline-offset-4 hover:underline"
          >
            Detalhes e aprovadores
          </Link>
          {canManage && (
            <div className="flex flex-wrap justify-end gap-2">
              <ClientFormDialog
                mode="edit"
                client={{ id: client.id, name: client.name, segment: client.segment, initials: client.initials }}
              />
              <ArchiveClientButton id={client.id} name={client.name} active={client.active} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
