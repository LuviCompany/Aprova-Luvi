"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Loader2, Send } from "lucide-react";
import { submitForApprovalAction } from "@/app/admin/materiais/approval-actions";
import { Notice } from "@/components/auth/auth-layout";
import { Field, describedBy } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { APPROVAL_POLICY_TEXT, MAX_MESSAGE } from "@/lib/approval/schema";
import type { ApproverOption } from "@/lib/approval/staff-queries";

interface SubmitApprovalDialogProps {
  versionId: string;
  versionNumber: number;
  approvers: ApproverOption[];
  /** Quando não pode enviar, o motivo aparece no botão desabilitado. */
  blockedReason?: string;
  /** Prazo atual do material (AAAA-MM-DD), sugerido no formulário. */
  suggestedDueDate?: string | null;
}

/** Envio da versão para aprovação: escolhe os aprovadores (todos precisam aprovar), prazo e recado. */
export function SubmitApprovalDialog({ versionId, versionNumber, approvers, blockedReason, suggestedDueDate }: SubmitApprovalDialogProps) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState(suggestedDueDate ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (approverId: string) =>
    setSelected((list) => (list.includes(approverId) ? list.filter((x) => x !== approverId) : [...list, approverId]));

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const result = await submitForApprovalAction({ versionId, approverIds: selected, dueDate: dueDate || null, message });
      if (result.ok) {
        setOpen(false);
        setSelected([]);
        setMessage("");
        router.refresh();
      } else {
        setError(result.error ?? "Não foi possível enviar para aprovação.");
      }
    });

  const disabled = Boolean(blockedReason);
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={disabled} title={blockedReason}>
        <Send data-icon="inline-start" /> Enviar para aprovação
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar a versão {versionNumber} para aprovação</DialogTitle>
            <DialogDescription>{APPROVAL_POLICY_TEXT}</DialogDescription>
          </DialogHeader>
          {error && <Notice tone="error">{error}</Notice>}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-white">Quem deve aprovar?</legend>
            {approvers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Este cliente não tem aprovadores ativos. Cadastre um aprovador antes de enviar.</p>
            ) : (
              approvers.map((approver) => (
                <label key={approver.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-white/10 p-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-[var(--color-primary)]"
                    checked={selected.includes(approver.id)}
                    onChange={() => toggle(approver.id)}
                  />
                  <span>
                    <span className="font-medium text-white">{approver.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {approver.email}
                      {approver.jobTitle ? ` · ${approver.jobTitle}` : ""}
                    </span>
                  </span>
                </label>
              ))
            )}
          </fieldset>

          <Field id={`${id}-due`} label="Prazo para responder (opcional)" hint="O prazo é exibido ao aprovador e ao dashboard.">
            <Input
              id={`${id}-due`}
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              aria-describedby={describedBy(`${id}-due`, "x")}
            />
          </Field>
          <Field id={`${id}-msg`} label="Recado para o aprovador (opcional)" hint={`Até ${MAX_MESSAGE} caracteres.`}>
            <Textarea id={`${id}-msg`} value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={MAX_MESSAGE} />
          </Field>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={pending || selected.length === 0}>
              {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
              Enviar para {selected.length || "…"} {selected.length === 1 ? "aprovador" : "aprovadores"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
