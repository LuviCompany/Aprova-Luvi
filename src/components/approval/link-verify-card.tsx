"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { Notice } from "@/components/auth/auth-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LinkVerifyCardProps {
  clientName: string;
  emailHint: string;
  onRequestCode: () => Promise<{ ok?: boolean; error?: string }>;
  onVerify: (code: string) => Promise<{ ok?: boolean; error?: string }>;
}

/** Passo de identidade do link rápido: pede o código por e-mail e confere. Nada do material aparece antes. */
export function LinkVerifyCard({ clientName, emailHint, onRequestCode, onVerify }: LinkVerifyCardProps) {
  const router = useRouter();
  const id = useId();
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const request = () =>
    startTransition(async () => {
      setError(null);
      const result = await onRequestCode();
      if (result.ok) setSent(true);
      else setError(result.error ?? "Não foi possível enviar o código.");
    });

  const verify = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      setError(null);
      const result = await onVerify(code);
      if (result.ok) router.refresh();
      else setError(result.error ?? "Código incorreto.");
    });
  };

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardContent className="flex flex-col gap-5">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <MailCheck className="size-6" aria-hidden />
        </div>
        <div>
          <h1 className="font-heading text-xl font-bold text-white">Confirme que é você</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Há um material de <strong className="text-white">{clientName}</strong> esperando a sua resposta. Para
            abri-lo, enviaremos um código de 6 números para <strong className="text-white">{emailHint}</strong>.
          </p>
        </div>

        {error && <Notice tone="error">{error}</Notice>}

        {!sent ? (
          <Button size="lg" onClick={request} disabled={pending}>
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" />} Enviar código por e-mail
          </Button>
        ) : (
          <form onSubmit={verify} className="flex flex-col gap-4">
            <Notice tone="success">Código enviado. Confira a sua caixa de entrada (vale por 10 minutos).</Notice>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-code`}>Código de 6 números</Label>
              <Input
                id={`${id}-code`}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
              />
            </div>
            <Button type="submit" size="lg" disabled={pending || code.length !== 6}>
              {pending && <Loader2 className="animate-spin" data-icon="inline-start" />} Confirmar e abrir o material
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={request} disabled={pending}>
              Enviar outro código
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
