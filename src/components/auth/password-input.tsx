"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PasswordInputProps = Omit<React.ComponentProps<"input">, "type"> & {
  /** Complemento do rótulo do botão: "Mostrar {subject}" / "Ocultar {subject}". */
  subject?: string;
};

/**
 * Campo de senha com botão de mostrar/ocultar. Oculta por padrão. Alternar só troca o `type` do mesmo
 * <input>, então o valor digitado não se perde, e o botão é `type="button"`, então nunca envia o formulário.
 * Visual idêntico ao `Input` (o único acréscimo é a folga à direita para o ícone).
 */
export function PasswordInput({ className, subject = "senha", disabled, ...props }: PasswordInputProps) {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        disabled={disabled}
        // O Edge desenha o próprio olho em campos de senha; sem isso apareceriam dois.
        className={cn("pr-11 [&::-ms-reveal]:hidden", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        disabled={disabled}
        aria-label={`${visible ? "Ocultar" : "Mostrar"} ${subject}`}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground outline-none transition-colors hover:text-white focus-visible:text-white focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
      >
        {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
}
