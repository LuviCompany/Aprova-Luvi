"use client";

import { useId, useState, useTransition } from "react";
import { Link2, Loader2 } from "lucide-react";
import { linkApproverAction } from "@/app/admin/clientes/[id]/actions";
import { Notice } from "@/components/auth/auth-layout";
import { Field, describedBy } from "@/components/form-field";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { LinkCandidate } from "@/lib/approvers/people";

interface LinkApproverDialogProps {
  clientId: string;
  candidates: LinkCandidate[];
}

/** Vincula a este cliente uma pessoa que já é aprovadora de outro cliente (o login, se houver, vai junto). */
export function LinkApproverDialog({ clientId, candidates }: LinkApproverDialogProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Link2 data-icon="inline-start" /> Vincular pessoa existente
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <LinkForm clientId={clientId} candidates={candidates} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function LinkForm({ clientId, candidates, onDone }: LinkApproverDialogProps & { onDone: () => void }) {
  const id = useId();
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const none = candidates.length === 0;
  const hint = none
    ? "Não há pessoas de outros clientes disponíveis para vincular."
    : "Mesmo e-mail e, se já tiver, o mesmo login. Cada cliente mantém o próprio vínculo.";

  const submit = () =>
    startTransition(async () => {
      const result = await linkApproverAction(selected, clientId);
      if (result.ok) onDone();
      else setError(result.error ?? "Não foi possível vincular. Tente novamente.");
    });

  return (
    <div className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Vincular pessoa existente</DialogTitle>
        <DialogDescription>
          Use quando a mesma pessoa aprova materiais de mais de um cliente. Ela passa a aparecer também neste cliente, com
          ativação e desativação independentes.
        </DialogDescription>
      </DialogHeader>
      {error && <Notice tone="error">{error}</Notice>}
      <Field id={`${id}-person`} label="Pessoa" hint={hint}>
        <NativeSelect
          id={`${id}-person`}
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          disabled={none}
          aria-describedby={describedBy(`${id}-person`, hint)}
        >
          <option value="" disabled>
            Escolha a pessoa
          </option>
          {candidates.map((c) => (
            <option key={c.sourceApproverId} value={c.sourceApproverId}>
              {c.name} · {c.email} ({c.clientNames.join(", ")})
            </option>
          ))}
        </NativeSelect>
      </Field>
      <DialogFooter>
        <Button variant="outline" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
        <Button onClick={submit} disabled={pending || !selected}>
          {pending ? (
            <>
              <Loader2 className="animate-spin" data-icon="inline-start" /> Vinculando…
            </>
          ) : (
            "Vincular a este cliente"
          )}
        </Button>
      </DialogFooter>
    </div>
  );
}
