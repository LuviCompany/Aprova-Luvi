"use client";

import { useActionState, useId, useState } from "react";
import { Loader2, Pencil, Plus } from "lucide-react";
import { saveClientAction, type ClientFormState } from "@/app/admin/clientes/actions";
import { Notice } from "@/components/auth/auth-layout";
import { Field, describedBy } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { initialsFromName } from "@/lib/clients/schema";

export interface EditableClient {
  id: string;
  name: string;
  segment: string;
  initials: string;
}

interface ClientFormDialogProps {
  mode: "create" | "edit";
  client?: EditableClient;
}

/** Botão + janela de cadastro/edição de cliente. A janela só existe aberta: cada abertura começa limpa. */
export function ClientFormDialog({ mode, client }: ClientFormDialogProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {mode === "create" ? (
        <Button onClick={() => setOpen(true)}>
          <Plus data-icon="inline-start" /> Novo cliente
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} aria-label={`Editar ${client?.name ?? "cliente"}`}>
          <Pencil data-icon="inline-start" /> Editar
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <ClientForm mode={mode} client={client} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function ClientForm({ mode, client, onDone }: ClientFormDialogProps & { onDone: () => void }) {
  const id = useId();
  const [name, setName] = useState(client?.name ?? "");
  const [state, formAction, pending] = useActionState<ClientFormState, FormData>(async (prev, formData) => {
    const result = await saveClientAction(prev, formData);
    if (result.ok) onDone();
    return result;
  }, {});
  const errors = state.fieldErrors ?? {};
  const suggested = name.trim() ? initialsFromName(name) : "";
  const initialsHint = suggested ? `Se ficar em branco, usamos ${suggested}.` : "De 1 a 3 letras ou números, usadas no avatar.";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{mode === "create" ? "Novo cliente" : "Editar cliente"}</DialogTitle>
        <DialogDescription>
          {mode === "create"
            ? "Cadastre a empresa atendida. Aprovadores e projetos são adicionados depois."
            : "Altere os dados do cliente. Os materiais e o histórico dele não mudam."}
        </DialogDescription>
      </DialogHeader>
      {mode === "edit" && client && <input type="hidden" name="id" value={client.id} />}
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <Field id={`${id}-name`} label="Nome do cliente" error={errors.name}>
        <Input
          id={`${id}-name`}
          name="name"
          required
          maxLength={120}
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={!!errors.name}
          aria-describedby={describedBy(`${id}-name`, undefined, errors.name)}
        />
      </Field>
      <Field id={`${id}-segment`} label="Segmento (opcional)" error={errors.segment}>
        <Input
          id={`${id}-segment`}
          name="segment"
          maxLength={120}
          autoComplete="off"
          defaultValue={client?.segment ?? ""}
          placeholder="Ex.: Varejo de móveis"
          aria-invalid={!!errors.segment}
          aria-describedby={describedBy(`${id}-segment`, undefined, errors.segment)}
        />
      </Field>
      <Field
        id={`${id}-initials`}
        label="Iniciais (opcional)"
        hint={initialsHint}
        error={errors.initials}
      >
        <Input
          id={`${id}-initials`}
          name="initials"
          maxLength={3}
          autoComplete="off"
          defaultValue={client?.initials ?? ""}
          className="w-28 uppercase"
          aria-invalid={!!errors.initials}
          aria-describedby={describedBy(`${id}-initials`, initialsHint, errors.initials)}
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
            "Cadastrar cliente"
          ) : (
            "Salvar alterações"
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}
