"use client";

import { Mail, MailX, UserCheck, UserX } from "lucide-react";
import {
  cancelInviteAction,
  prepareInviteAction,
  setApproverActiveAction,
} from "@/app/admin/clientes/[id]/actions";
import { ConfirmActionDialog } from "@/components/approvers/confirm-action-dialog";

/** Ativar/desativar o aprovador NESTE cliente. */
export function ApproverActiveButton({ id, name, active }: { id: string; name: string; active: boolean }) {
  return active ? (
    <ConfirmActionDialog
      triggerLabel="Desativar"
      triggerAriaLabel={`Desativar ${name}`}
      triggerIcon={<UserX data-icon="inline-start" />}
      title={`Desativar ${name} neste cliente?`}
      description="Ele deixa de aprovar materiais deste cliente: os links de aprovação ainda abertos são revogados e um convite em aberto é cancelado. As decisões já registradas são mantidas. Em outros clientes, nada muda. Você pode reativar depois, mas os links revogados não voltam."
      confirmLabel="Desativar aprovador"
      destructive
      onConfirm={() => setApproverActiveAction(id, false)}
    />
  ) : (
    <ConfirmActionDialog
      triggerLabel="Reativar"
      triggerAriaLabel={`Reativar ${name}`}
      triggerIcon={<UserCheck data-icon="inline-start" />}
      title={`Reativar ${name} neste cliente?`}
      description="Ele volta a poder aprovar materiais deste cliente. Novos links de aprovação precisam ser criados."
      confirmLabel="Reativar aprovador"
      onConfirm={() => setApproverActiveAction(id, true)}
    />
  );
}

/** Preparar (ou cancelar) o convite de acesso ao portal. Nada é enviado nesta etapa. */
export function InviteButton({ approverId, name, inviteId }: { approverId: string; name: string; inviteId: string | null }) {
  return inviteId ? (
    <ConfirmActionDialog
      triggerLabel="Cancelar convite"
      triggerAriaLabel={`Cancelar convite de ${name}`}
      triggerIcon={<MailX data-icon="inline-start" />}
      title={`Cancelar o convite de ${name}?`}
      description="O convite deixa de estar preparado. Nenhum e-mail foi enviado."
      confirmLabel="Cancelar convite"
      onConfirm={() => cancelInviteAction(inviteId)}
    />
  ) : (
    <ConfirmActionDialog
      triggerLabel="Preparar convite"
      triggerAriaLabel={`Preparar convite de ${name}`}
      triggerIcon={<Mail data-icon="inline-start" />}
      title={`Preparar o convite de ${name}?`}
      description="Registra que esta pessoa deve receber acesso ao portal. Nenhum e-mail é enviado e nenhum acesso é criado agora: o envio será habilitado em uma etapa futura."
      confirmLabel="Preparar convite"
      onConfirm={() => prepareInviteAction(approverId)}
    />
  );
}
