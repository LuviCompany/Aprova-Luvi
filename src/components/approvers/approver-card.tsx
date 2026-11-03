import { ApproverActiveButton, InviteButton } from "@/components/approvers/approver-actions";
import { ApproverFormDialog } from "@/components/approvers/approver-form-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ACCESS_LABEL } from "@/lib/approvers/schema";
import type { ApproverItem } from "@/lib/approvers/queries";

interface ApproverCardProps {
  approver: ApproverItem;
  /** Mostra editar, (des)ativar e convite. Falso para o designer e na demonstração. */
  canManage: boolean;
  /** Cliente arquivado: não oferece convite (o banco recusa). */
  clientActive: boolean;
}

const ACCESS_TONE: Record<ApproverItem["access"], "default" | "secondary" | "outline"> = {
  login: "default",
  convite_preparado: "outline",
  convite_enviado: "outline",
  so_link: "secondary",
};

export function ApproverCard({ approver, canManage, clientActive }: ApproverCardProps) {
  return (
    <Card className={approver.active ? undefined : "opacity-80"}>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-heading text-base font-bold text-white">{approver.name}</h3>
            <p className="truncate text-sm text-muted-foreground">
              {approver.jobTitle ? `${approver.jobTitle} · ` : ""}
              {approver.email}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={approver.active ? "default" : "secondary"}>{approver.active ? "Ativo" : "Inativo"}</Badge>
            {approver.active && <Badge variant={ACCESS_TONE[approver.access]}>{ACCESS_LABEL[approver.access]}</Badge>}
          </div>
        </div>
        {approver.alsoApprovesFor.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Também aprova para: <span className="text-white">{approver.alsoApprovesFor.join(", ")}</span>
          </p>
        )}
        {canManage && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 pt-3">
            <ApproverFormDialog
              mode="edit"
              approver={{ id: approver.id, name: approver.name, email: approver.email, jobTitle: approver.jobTitle }}
            />
            {approver.active && !approver.hasLogin && (approver.inviteId || clientActive) && (
              <InviteButton approverId={approver.id} name={approver.name} inviteId={approver.inviteId} />
            )}
            <ApproverActiveButton id={approver.id} name={approver.name} active={approver.active} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
