"use client";

import { useState, useTransition } from "react";
import { Archive, ArchiveRestore, Loader2 } from "lucide-react";
import { setClientActiveAction } from "@/app/admin/clientes/actions";
import { Notice } from "@/components/auth/auth-layout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ArchiveClientButtonProps {
  id: string;
  name: string;
  active: boolean;
}

/** Arquivar esconde o cliente do portal e bloqueia projetos novos; nada é apagado e dá para reativar. */
export function ArchiveClientButton({ id, name, active }: ArchiveClientButtonProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const confirm = () =>
    startTransition(async () => {
      const result = await setClientActiveAction(id, !active);
      if (result.ok) {
        setOpen(false);
        setError(null);
      } else {
        setError(result.error ?? "Não foi possível concluir. Tente novamente.");
      }
    });

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={`${active ? "Arquivar" : "Reativar"} ${name}`}>
        {active ? <Archive data-icon="inline-start" /> : <ArchiveRestore data-icon="inline-start" />}
        {active ? "Arquivar" : "Reativar"}
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
            <DialogTitle>{active ? `Arquivar ${name}?` : `Reativar ${name}?`}</DialogTitle>
            <DialogDescription>
              {active
                ? "O cliente deixa de aparecer no portal e não recebe novos projetos. Materiais, decisões e histórico são mantidos, e você pode reativá-lo quando quiser."
                : "O cliente volta a aparecer no portal e pode receber novos projetos."}
            </DialogDescription>
          </DialogHeader>
          {error && <Notice tone="error">{error}</Notice>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button variant={active ? "destructive" : "default"} onClick={confirm} disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="animate-spin" data-icon="inline-start" /> Salvando…
                </>
              ) : active ? (
                "Arquivar cliente"
              ) : (
                "Reativar cliente"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
