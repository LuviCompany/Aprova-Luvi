"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Notice } from "@/components/auth/auth-layout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ConfirmActionDialogProps {
  /** Texto do botão que abre a janela. */
  triggerLabel: string;
  triggerAriaLabel: string;
  triggerIcon?: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  /** Executa a ação; devolve `{ ok }` ou `{ error }` (formato das Server Actions de aprovadores). */
  onConfirm: () => Promise<{ ok?: boolean; error?: string }>;
}

/** Botão + janela de confirmação para ações de um clique (ativar/desativar, preparar/cancelar convite). */
export function ConfirmActionDialog({
  triggerLabel,
  triggerAriaLabel,
  triggerIcon,
  title,
  description,
  confirmLabel,
  destructive = false,
  onConfirm,
}: ConfirmActionDialogProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const confirm = () =>
    startTransition(async () => {
      const result = await onConfirm();
      if (result.ok) {
        setOpen(false);
        setError(null);
      } else {
        setError(result.error ?? "Não foi possível concluir. Tente novamente.");
      }
    });

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={triggerAriaLabel}>
        {triggerIcon}
        {triggerLabel}
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
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {error && <Notice tone="error">{error}</Notice>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button variant={destructive ? "destructive" : "default"} onClick={confirm} disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="animate-spin" data-icon="inline-start" /> Salvando…
                </>
              ) : (
                confirmLabel
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
