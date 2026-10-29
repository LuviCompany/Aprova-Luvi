"use client";

import { useId, useState } from "react";
import { CheckCircle2, MessageSquareWarning, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { STATUS_LABEL } from "@/lib/domain";
import type { MaterialStatus } from "@/lib/types";

export const MIN_CHANGE_NOTE_LENGTH = 10;

interface DecisionPanelProps {
  status: MaterialStatus;
  version: number;
  onDecide: (decision: "aprovado" | "alteracao", note?: string) => void;
}

export function DecisionPanel({ status, version, onDecide }: DecisionPanelProps) {
  const id = useId();
  const [dialog, setDialog] = useState<"aprovado" | "alteracao" | null>(null);
  const [note, setNote] = useState("");

  const close = () => {
    setDialog(null);
    setNote("");
  };

  if (status !== "aguardando") {
    return (
      <div
        role="status"
        className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-muted-foreground"
      >
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Este material está em <strong className="text-white">{STATUS_LABEL[status]}</strong>. A decisão
          só pode ser registrada enquanto a versão estiver aguardando aprovação.
        </span>
      </div>
    );
  }

  const noteTooShort = dialog === "alteracao" && note.trim().length < MIN_CHANGE_NOTE_LENGTH;

  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button size="lg" className="flex-1" onClick={() => setDialog("aprovado")}>
          <CheckCircle2 data-icon="inline-start" /> Aprovar
        </Button>
        <Button size="lg" variant="outline" className="flex-1" onClick={() => setDialog("alteracao")}>
          <MessageSquareWarning data-icon="inline-start" /> Solicitar alteração
        </Button>
      </div>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === "aprovado" ? `Aprovar a versão ${version}?` : "Solicitar alteração"}
            </DialogTitle>
            <DialogDescription>
              {dialog === "aprovado"
                ? "Sua decisão fica registrada com data, hora e identificação, e não pode ser desfeita por você."
                : "Descreva o que precisa mudar. A equipe da Luvi será avisada e enviará uma nova versão."}
            </DialogDescription>
          </DialogHeader>
          {dialog === "alteracao" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-note`}>O que precisa mudar?</Label>
              <Textarea
                id={`${id}-note`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
                placeholder="Ex.: trocar a foto do slide 2 por uma com fundo claro."
                aria-describedby={`${id}-hint`}
              />
              <p id={`${id}-hint`} className="text-xs text-muted-foreground">
                Mínimo de {MIN_CHANGE_NOTE_LENGTH} caracteres.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Cancelar
            </Button>
            <Button
              disabled={noteTooShort}
              onClick={() => {
                if (dialog) onDecide(dialog, dialog === "alteracao" ? note.trim() : undefined);
                close();
              }}
            >
              {dialog === "aprovado" ? "Confirmar aprovação" : "Enviar solicitação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
