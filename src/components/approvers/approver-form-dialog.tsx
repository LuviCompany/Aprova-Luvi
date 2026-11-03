"use client";

import { useActionState, useId, useState } from "react";
import { Loader2, Pencil, UserPlus } from "lucide-react";
import { saveApproverAction, type ApproverFormState } from "@/app/admin/clientes/[id]/actions";
import { Notice } from "@/components/auth/auth-layout";
import { Field, describedBy } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export interface EditableApprover {
  id: string;
  name: string;
  email: string;
  jobTitle: string;
}

interface ApproverFormDialogProps {
  mode: "create" | "edit";
  /** Cliente ao qual o aprovador será vinculado (cadastro). */
  clientId?: string;
  approver?: EditableApprover;
}

export function ApproverFormDialog({ mode, clientId, approver }: ApproverFormDialogProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {mode === "create" ? (
        <Button onClick={() => setOpen(true)}>
          <UserPlus data-icon="inline-start" /> Novo aprovador
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} aria-label={`Editar ${approver?.name ?? "aprovador"}`}>
          <Pencil data-icon="inline-start" /> Editar
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <ApproverForm mode={mode} clientId={clientId} approver={approver} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function ApproverForm({ mode, clientId, approver, onDone }: ApproverFormDialogProps & { onDone: () => void }) {
  const id = useId();
  const [state, formAction, pending] = useActionState<ApproverFormState, FormData>(async (prev, formData) => {
    const result = await saveApproverAction(prev, formData);
    if (result.ok) onDone();
    return result;
  }, {});
  const errors = state.fieldErrors ?? {};
  const emailHint = "Usado para o login e para o link de aprovação. Não pode ser alterado depois.";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{mode === "create" ? "Novo aprovador" : "Editar aprovador"}</DialogTitle>
        <DialogDescription>
          {mode === "create"
            ? "Pessoa do cliente que aprova os materiais. O acesso ao portal é preparado depois, sem envio de e-mail agora."
            : "Altere o nome ou o cargo. O e-mail não muda para preservar o histórico de aprovações."}
        </DialogDescription>
      </DialogHeader>
      {mode === "edit" && approver && <input type="hidden" name="id" value={approver.id} />}
      {mode === "create" && clientId && <input type="hidden" name="clientId" value={clientId} />}
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <Field id={`${id}-name`} label="Nome" error={errors.name}>
        <Input
          id={`${id}-name`}
          name="name"
          required
          maxLength={120}
          autoComplete="off"
          defaultValue={approver?.name ?? ""}
          aria-invalid={!!errors.name}
          aria-describedby={describedBy(`${id}-name`, undefined, errors.name)}
        />
      </Field>
      {mode === "create" ? (
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
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm leading-none font-medium">E-mail</span>
          <p className="text-sm text-muted-foreground">{approver?.email}</p>
        </div>
      )}
      <Field id={`${id}-job`} label="Cargo (opcional)" error={errors.jobTitle}>
        <Input
          id={`${id}-job`}
          name="jobTitle"
          maxLength={120}
          autoComplete="off"
          defaultValue={approver?.jobTitle ?? ""}
          placeholder="Ex.: Diretora de marketing"
          aria-invalid={!!errors.jobTitle}
          aria-describedby={describedBy(`${id}-job`, undefined, errors.jobTitle)}
        />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? (
            <>
              <Loader2 className="animate-spin" data-icon="inline-start" /> Salvando…
            </>
          ) : mode === "create" ? (
            "Cadastrar aprovador"
          ) : (
            "Salvar alterações"
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}
