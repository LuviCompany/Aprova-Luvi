"use client";

import { useActionState, useId, useState } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { inviteTeamMemberAction, type TeamInviteState } from "@/app/admin/usuarios/actions";
import { Notice } from "@/components/auth/auth-layout";
import { Field, describedBy } from "@/components/form-field";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DEFAULT_INVITE_ROLE, INVITABLE_ROLE_OPTIONS } from "@/lib/users/schema";

/** Botão "Adicionar usuário" + janela do convite. Só aparece para administradores (a página já é só deles). */
export function TeamInviteDialog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlus data-icon="inline-start" /> Adicionar usuário
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          {/* Remonta o formulário a cada abertura: campos e erros sempre limpos. */}
          {open && <TeamInviteForm onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function TeamInviteForm({ onDone }: { onDone: () => void }) {
  const id = useId();
  const [state, formAction, pending] = useActionState<TeamInviteState, FormData>(async (prev, formData) => {
    const result = await inviteTeamMemberAction(prev, formData);
    if (result.ok) onDone();
    return result;
  }, {});
  const errors = state.fieldErrors ?? {};
  const emailHint = "O convite com o link para criar a senha é enviado para este endereço. Confira com atenção.";
  const roleHint = INVITABLE_ROLE_OPTIONS.map((option) => `${option.label}: ${option.hint}`).join(" ");

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Adicionar usuário</DialogTitle>
        <DialogDescription>
          A pessoa recebe um e-mail com um link (válido por 24 horas, de uso único) para criar a própria senha. Você nunca vê nem define a senha.
        </DialogDescription>
      </DialogHeader>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <Field id={`${id}-name`} label="Nome completo" error={errors.name}>
        <Input
          id={`${id}-name`}
          name="name"
          required
          maxLength={120}
          autoComplete="off"
          aria-invalid={!!errors.name}
          aria-describedby={describedBy(`${id}-name`, undefined, errors.name)}
        />
      </Field>
      <Field id={`${id}-email`} label="E-mail" hint={emailHint} error={errors.email}>
        <Input
          id={`${id}-email`}
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="off"
          aria-invalid={!!errors.email}
          aria-describedby={describedBy(`${id}-email`, emailHint, errors.email)}
        />
      </Field>
      <Field id={`${id}-emailConfirm`} label="Confirmar e-mail" error={errors.emailConfirm}>
        <Input
          id={`${id}-emailConfirm`}
          name="emailConfirm"
          type="email"
          required
          maxLength={254}
          autoComplete="off"
          aria-invalid={!!errors.emailConfirm}
          aria-describedby={describedBy(`${id}-emailConfirm`, undefined, errors.emailConfirm)}
        />
      </Field>
      <Field id={`${id}-role`} label="Papel" hint={roleHint} error={errors.role}>
        <NativeSelect
          id={`${id}-role`}
          name="role"
          defaultValue={DEFAULT_INVITE_ROLE}
          aria-invalid={!!errors.role}
          aria-describedby={describedBy(`${id}-role`, roleHint, errors.role)}
        >
          {INVITABLE_ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? (
            <>
              <Loader2 className="animate-spin" data-icon="inline-start" /> Enviando…
            </>
          ) : (
            "Enviar convite"
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}
