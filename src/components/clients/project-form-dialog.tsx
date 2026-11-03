"use client";

import { useActionState, useId, useState } from "react";
import { Loader2, Pencil, Plus } from "lucide-react";
import { saveProjectAction, type ProjectFormState } from "@/app/admin/projetos/actions";
import { Notice } from "@/components/auth/auth-layout";
import { Field, describedBy } from "@/components/form-field";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PROJECT_STATUSES, PROJECT_STATUS_LABEL, type ProjectStatusValue } from "@/lib/clients/schema";

export interface EditableProject {
  id: string;
  clientName: string;
  name: string;
  description: string;
  status: ProjectStatusValue;
  dueDate: string | null;
}

interface ProjectFormDialogProps {
  mode: "create" | "edit";
  /** Clientes ATIVOS, para o cadastro (o cliente de um projeto não muda depois). */
  clients?: Array<{ id: string; name: string }>;
  project?: EditableProject;
}

export function ProjectFormDialog({ mode, clients = [], project }: ProjectFormDialogProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {mode === "create" ? (
        <Button onClick={() => setOpen(true)}>
          <Plus data-icon="inline-start" /> Novo projeto
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} aria-label={`Editar ${project?.name ?? "projeto"}`}>
          <Pencil data-icon="inline-start" /> Editar
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <ProjectForm mode={mode} clients={clients} project={project} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProjectForm({ mode, clients, project, onDone }: ProjectFormDialogProps & { onDone: () => void }) {
  const id = useId();
  const [state, formAction, pending] = useActionState<ProjectFormState, FormData>(async (prev, formData) => {
    const result = await saveProjectAction(prev, formData);
    if (result.ok) onDone();
    return result;
  }, {});
  const errors = state.fieldErrors ?? {};
  const noClients = mode === "create" && (clients?.length ?? 0) === 0;
  const clientHint = noClients ? "Cadastre um cliente ativo antes de criar projetos." : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{mode === "create" ? "Novo projeto" : "Editar projeto"}</DialogTitle>
        <DialogDescription>
          {mode === "create"
            ? "Um projeto agrupa os materiais de uma campanha ou entrega de um cliente."
            : `Projeto de ${project?.clientName ?? "cliente"}. O cliente não pode ser trocado.`}
        </DialogDescription>
      </DialogHeader>
      {mode === "edit" && project && <input type="hidden" name="id" value={project.id} />}
      {state.error && <Notice tone="error">{state.error}</Notice>}

      {mode === "create" && (
        <Field
          id={`${id}-client`}
          label="Cliente"
          error={errors.clientId}
          hint={clientHint}
        >
          <NativeSelect
            id={`${id}-client`}
            name="clientId"
            required
            disabled={noClients}
            defaultValue=""
            aria-invalid={!!errors.clientId}
            aria-describedby={describedBy(`${id}-client`, clientHint, errors.clientId)}
          >
            <option value="" disabled>
              Escolha o cliente
            </option>
            {clients?.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}

      <Field id={`${id}-name`} label="Nome do projeto" error={errors.name}>
        <Input
          id={`${id}-name`}
          name="name"
          required
          maxLength={160}
          autoComplete="off"
          defaultValue={project?.name ?? ""}
          aria-invalid={!!errors.name}
          aria-describedby={describedBy(`${id}-name`, undefined, errors.name)}
        />
      </Field>
      <Field id={`${id}-description`} label="Descrição (opcional)" error={errors.description}>
        <Textarea
          id={`${id}-description`}
          name="description"
          maxLength={2000}
          rows={3}
          defaultValue={project?.description ?? ""}
          aria-invalid={!!errors.description}
          aria-describedby={describedBy(`${id}-description`, undefined, errors.description)}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${id}-status`} label="Status" error={errors.status}>
          <NativeSelect id={`${id}-status`} name="status" defaultValue={project?.status ?? "ativo"}>
            {PROJECT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {PROJECT_STATUS_LABEL[value]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id={`${id}-due`} label="Data de entrega (opcional)" error={errors.dueDate}>
          <Input
            id={`${id}-due`}
            name="dueDate"
            type="date"
            defaultValue={project?.dueDate ?? ""}
            aria-invalid={!!errors.dueDate}
            aria-describedby={describedBy(`${id}-due`, undefined, errors.dueDate)}
          />
        </Field>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending || noClients}>
          {pending ? (
            <>
              <Loader2 className="animate-spin" data-icon="inline-start" /> Salvando…
            </>
          ) : mode === "create" ? (
            "Cadastrar projeto"
          ) : (
            "Salvar alterações"
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}
