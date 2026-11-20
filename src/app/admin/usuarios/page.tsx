import type { Metadata } from "next";
import { Suspense } from "react";
import { Users } from "lucide-react";
import { EmptyState, LoadErrorState } from "@/components/admin/data-states";
import { PageHeader } from "@/components/page-header";
import { ListSkeleton } from "@/components/page-skeleton";
import { ResendTeamInviteButton } from "@/components/users/resend-team-invite-button";
import { TeamInviteDialog } from "@/components/users/team-invite-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLE_LABEL } from "@/lib/auth/roles";
import { requireAdmin } from "@/lib/auth/session";
import { DataLoadError } from "@/lib/clients/queries";
import { isDemoMode } from "@/lib/env";
import { formatDateTime, formatFullDate } from "@/lib/format";
import { listPendingTeamInvites } from "@/lib/invites/team";
import { teamUsers } from "@/lib/mock/data";
import { listTeamUsers } from "@/lib/users/queries";

export const metadata: Metadata = { title: "Usuários" };

const DESCRIPTION = "Equipe Luvi com acesso ao painel administrativo.";

export default function AdminUsersPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <UsersContent />
    </Suspense>
  );
}

async function UsersContent() {
  // Só o administrador. Feito no servidor, a cada requisição: designer e atendimento são enviados ao painel mesmo
  // digitando a URL; esconder o item do menu é só conveniência (ver AdminGate).
  const user = await requireAdmin();

  // Demonstração: a equipe fictícia da Fase 1. Fora dela, nada fictício aparece.
  if (isDemoMode()) return <UsersDemo />;

  let users: Awaited<ReturnType<typeof listTeamUsers>>;
  try {
    users = await listTeamUsers(user.organizationId);
  } catch (error) {
    if (!(error instanceof DataLoadError)) throw error;
    return (
      <>
        <PageHeader title="Usuários" description={DESCRIPTION} actions={<TeamInviteDialog />} />
        <LoadErrorState what="os usuários" />
      </>
    );
  }
  // Quem ainda não criou a senha (convite pendente). Só leitura no Auth; se falhar, ninguém aparece como pendente.
  const pending = await listPendingTeamInvites(users.map((u) => u.id));

  return (
    <>
      <PageHeader title="Usuários" description={DESCRIPTION} actions={<TeamInviteDialog />} />
      {users.length === 0 ? (
        <EmptyState icon={Users} title="Nenhum usuário da equipe encontrado" />
      ) : (
        <Card>
          <CardContent>
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Papel</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Cadastrado em</TableHead>
                    <TableHead>
                      <span className="sr-only">Ações</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => {
                    const isPending = pending.has(u.id);
                    return (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium text-white">{u.name}</TableCell>
                        <TableCell>{u.email}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{ROLE_LABEL[u.role]}</Badge>
                        </TableCell>
                        <TableCell>
                          {isPending ? (
                            <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">
                              Convite pendente
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className={u.active ? "border-success/30 bg-success/10 text-success" : "border-white/15 bg-white/5 text-muted-foreground"}
                            >
                              {u.active ? "Ativo" : "Inativo"}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{formatFullDate(u.createdAt)}</TableCell>
                        <TableCell className="text-right">
                          {isPending && <ResendTeamInviteButton userId={u.id} name={u.name} email={u.email} />}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

/** Demonstração: equipe fictícia de src/lib/mock, como na Fase 1. Sem cadastro: nada é gravado na demonstração. */
function UsersDemo() {
  return (
    <>
      <PageHeader title="Usuários" description={DESCRIPTION} />
      <Card>
        <CardContent>
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead>Último acesso</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teamUsers.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium text-white">{u.name}</TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{ROLE_LABEL[u.role]}</Badge>
                    </TableCell>
                    <TableCell>{formatDateTime(u.lastAccess)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
