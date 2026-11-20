"use client";

import { Send } from "lucide-react";
import { resendTeamInviteAction } from "@/app/admin/usuarios/actions";
import { ConfirmActionDialog } from "@/components/approvers/confirm-action-dialog";

/** Reenviar o convite de quem ainda não criou a senha (novo link; no máximo 1 por minuto). */
export function ResendTeamInviteButton({ userId, name, email }: { userId: string; name: string; email: string }) {
  return (
    <ConfirmActionDialog
      triggerLabel="Reenviar convite"
      triggerAriaLabel={`Reenviar convite de ${name}`}
      triggerIcon={<Send data-icon="inline-start" />}
      title={`Reenviar o convite de ${name}?`}
      description={`Um novo link para criar a senha será enviado para ${email}.`}
      confirmLabel="Reenviar convite"
      onConfirm={() => resendTeamInviteAction(userId)}
    />
  );
}
