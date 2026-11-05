"use client";

import { Mail, MailX, Send, UserCheck, UserX } from "lucide-react";
import {
  cancelInviteAction,
  prepareInviteAction,
  sendInviteAction,
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

/**
 * Convite de acesso ao portal, em três passos: PREPARAR (só registra), ENVIAR (cria o acesso e manda o e-mail com o link
 * para a pessoa criar a própria senha) e REENVIAR (novo link, enquanto ela não ativou). A equipe nunca vê nem define senha.
 */
export function InviteButton({
  approverId,
  name,
  email,
  inviteId,
  inviteStatus,
}: {
  approverId: string;
  name: string;
  email: string;
  inviteId: string | null;
  inviteStatus: "preparado" | "enviado" | null;
}) {
  if (inviteStatus === "enviado") {
    return (
      <ConfirmActionDialog
        triggerLabel="Reenviar convite"
        triggerAriaLabel={`Reenviar convite de ${name}`}
        triggerIcon={<Send data-icon="inline-start" />}
        title={`Reenviar o convite de ${name}?`}
        description={`Um novo link para criar a senha será enviado por e-mail para ${email}. O link anterior deixa de valer.`}
        confirmLabel="Reenviar convite"
        onConfirm={() => sendInviteAction(approverId)}
      />
    );
  }
  if (inviteId) {
    return (
      <>
        <ConfirmActionDialog
          triggerLabel="Enviar convite"
          triggerAriaLabel={`Enviar convite de ${name}`}
          triggerIcon={<Send data-icon="inline-start" />}
          title={`Enviar o convite para ${name}?`}
          description={`Será criado o acesso ao portal e enviado um e-mail para ${email} com um link (válido por 24 horas) para a pessoa criar a própria senha.`}
          confirmLabel="Enviar convite"
          onConfirm={() => sendInviteAction(approverId)}
        />
        <ConfirmActionDialog
          triggerLabel="Cancelar convite"
          triggerAriaLabel={`Cancelar convite de ${name}`}
          triggerIcon={<MailX data-icon="inline-start" />}
          title={`Cancelar o convite de ${name}?`}
          description="O convite deixa de estar preparado. Nenhum e-mail foi enviado."
          confirmLabel="Cancelar convite"
          onConfirm={() => cancelInviteAction(inviteId)}
        />
      </>
    );
  }
  return (
    <ConfirmActionDialog
      triggerLabel="Preparar convite"
      triggerAriaLabel={`Preparar convite de ${name}`}
      triggerIcon={<Mail data-icon="inline-start" />}
      title={`Preparar o convite de ${name}?`}
      description="Registra que esta pessoa deve receber acesso ao portal. Nenhum e-mail é enviado agora: o envio é o passo seguinte (“Enviar convite”)."
      confirmLabel="Preparar convite"
      onConfirm={() => prepareInviteAction(approverId)}
    />
  );
}
