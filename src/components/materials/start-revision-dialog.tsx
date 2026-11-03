"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Loader2, RefreshCcw } from "lucide-react";
import { startRevisionAction } from "@/app/admin/materiais/files-actions";
import { Notice } from "@/components/auth/auth-layout";
import { Field, describedBy } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { charCount } from "@/lib/materials/schema";
import type { MaterialStatus } from "@/lib/types";

/** Operação explícita de revisão: nova versão de material aprovado ou com alteração pedida, com motivo registrado. */
export function StartRevisionDialog({ materialId, status }: { materialId: string; status: MaterialStatus }) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const count = charCount(reason.trim());
  const valid = count >= 10 && count <= 500;
  const approved = status === "aprovado";

  const submit = () =>
    startTransition(async () => {
      const result = await startRevisionAction(materialId, reason);
      if (result.ok) {
        setOpen(false);
        setReason("");
        router.refresh();
      } else {
        setError(result.error ?? "Não foi possível iniciar a revisão.");
      }
    });

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <RefreshCcw data-icon="inline-start" /> Iniciar revisão
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
            <DialogTitle>Iniciar revisão deste material</DialogTitle>
            <DialogDescription>
              {approved
                ? "O material aprovado volta a rascunho numa NOVA versão. A versão aprovada, os arquivos e as decisões anteriores ficam preservados no histórico."
                : "Cria a próxima versão para aplicar as alterações pedidas. As versões e decisões anteriores ficam preservadas no histórico."}
            </DialogDescription>
          </DialogHeader>
          {error && <Notice tone="error">{error}</Notice>}
          <Field id={`${id}-reason`} label="Motivo da revisão" hint="De 10 a 500 caracteres. Fica registrado na nova versão.">
            <Textarea
              id={`${id}-reason`}
              rows={4}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              aria-describedby={describedBy(`${id}-reason`, "x")}
            />
            <p aria-live="polite" className="text-right text-xs text-muted-foreground">
              {count} / 500
            </p>
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={pending || !valid}>
              {pending ? (
                <>
                  <Loader2 className="animate-spin" data-icon="inline-start" /> Iniciando…
                </>
              ) : (
                "Iniciar revisão"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
