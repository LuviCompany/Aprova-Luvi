"use client";

import { useActionState, useId } from "react";
import { Loader2 } from "lucide-react";
import { updatePasswordAction, type ResetPasswordState } from "@/app/redefinir-senha/actions";
import { Notice } from "@/components/auth/auth-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";

export function ResetPasswordForm() {
  const id = useId();
  const [state, formAction, pending] = useActionState<ResetPasswordState, FormData>(updatePasswordAction, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-password`}>Nova senha</Label>
        <Input
          id={`${id}-password`}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          className="h-11"
          aria-describedby={`${id}-hint`}
        />
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          Mínimo de {MIN_PASSWORD_LENGTH} caracteres, com letras e números.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-confirm`}>Confirme a nova senha</Label>
        <Input
          id={`${id}-confirm`}
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          className="h-11"
        />
      </div>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="animate-spin" data-icon="inline-start" /> Salvando…
          </>
        ) : (
          "Salvar nova senha"
        )}
      </Button>
    </form>
  );
}
