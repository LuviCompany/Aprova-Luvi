import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { teamUsers } from "@/lib/mock/data";
import type { TeamUser } from "@/lib/types";

export const metadata: Metadata = { title: "Usuários" };

const ROLE_LABEL: Record<TeamUser["role"], string> = {
  admin: "Administrador",
  designer: "Designer",
  atendimento: "Atendimento",
};

export default function AdminUsersPage() {
  return (
    <>
      <PageHeader title="Usuários" description="Equipe Luvi com acesso ao painel administrativo." />
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
