"use client";

import Link from "next/link";
import { useActionState, useId } from "react";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { requestPasswordResetAction, type ForgotPasswordState } from "@/app/esqueci-senha/actions";
import { Notice } from "@/components/auth/auth-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPasswordForm() {
  const id = useId();
  const [state, formAction, pending] = useActionState<ForgotPasswordState, FormData>(
    requestPasswordResetAction,
    {},
  );

  if (state.sent) {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="success">
          <MailCheck className="mr-1.5 inline size-4 align-text-bottom" aria-hidden />
          Se o e-mail estiver cadastrado, enviamos um link para criar uma nova senha. Ele vale por tempo
          limitado.
        </Notice>
        <Button variant="outline" render={<Link href="/login" />}>
          <ArrowLeft data-icon="inline-start" /> Voltar ao login
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-email`}>E-mail</Label>
        <Input id={`${id}-email`} name="email" type="email" autoComplete="email" required className="h-11" />
      </div>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="animate-spin" data-icon="inline-start" /> Enviando…
          </>
        ) : (
          "Enviar link de redefinição"
        )}
      </Button>
      <Link
        href="/login"
        className="text-center text-sm text-muted-foreground underline-offset-4 hover:text-white hover:underline"
      >
        Voltar ao login
      </Link>
    </form>
  );
}
