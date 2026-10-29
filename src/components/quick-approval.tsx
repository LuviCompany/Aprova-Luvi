"use client";

import { useId, useState, type FormEvent } from "react";
import { CheckCircle2, MailCheck, MessageSquareWarning } from "lucide-react";
import { MaterialReview } from "@/components/material-review";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Client, Comment, Decision, Material, MaterialStatus, Project } from "@/lib/types";

/** Código fixo da demonstração. Na Fase 2 o código é gerado, enviado por e-mail e validado no servidor. */
export const DEMO_CODE = "123456";

interface QuickApprovalProps {
  material: Material;
  client: Client;
  project: Project;
  approverName: string;
  maskedEmail: string;
  comments: Comment[];
  decisions: Decision[];
}

type Step = "identidade" | "revisao" | "concluido";

export function QuickApproval({
  material,
  client,
  project,
  approverName,
  maskedEmail,
  comments,
  decisions,
}: QuickApprovalProps) {
  const id = useId();
  const [step, setStep] = useState<Step>("identidade");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MaterialStatus | null>(null);

  const verify = (event: FormEvent) => {
    event.preventDefault();
    if (code.trim() !== DEMO_CODE) {
      setError("Código incorreto. Confira o código enviado ao seu e-mail.");
      return;
    }
    setError(null);
    setStep("revisao");
  };

  if (step === "identidade") {
    return (
      <Card className="mx-auto w-full max-w-md">
        <CardContent className="flex flex-col gap-5">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <MailCheck className="size-6" aria-hidden />
          </div>
          <div>
            <h1 className="font-heading text-xl font-bold text-white">Confirme que é você</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Olá, {approverName.split(" ")[0]}! Enviamos um código de 6 dígitos para{" "}
              <strong className="text-white">{maskedEmail}</strong>. Digite-o abaixo para abrir o material.
            </p>
          </div>
          <form onSubmit={verify} noValidate className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-code`}>Código de verificação</Label>
              <Input
                id={`${id}-code`}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                aria-invalid={!!error}
                aria-describedby={error ? `${id}-error` : undefined}
                className="h-12 text-center font-mono text-xl tracking-[0.4em]"
                placeholder="000000"
              />
              {error && (
                <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
            </div>
            <Button type="submit" size="lg" disabled={code.length !== 6}>
              Abrir material
            </Button>
          </form>
          <p className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-muted-foreground">
            Demonstração (Fase 1): use o código <span className="font-mono text-white">{DEMO_CODE}</span>.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (step === "concluido") {
    const approved = result === "aprovado";
    return (
      <Card className="mx-auto w-full max-w-md" data-testid="quick-approval-done">
        <CardContent className="flex flex-col items-center gap-4 py-6 text-center">
          <div
            className={`flex size-14 items-center justify-center rounded-full ${approved ? "bg-success/15 text-success" : "bg-primary/15 text-primary"}`}
          >
            {approved ? <CheckCircle2 className="size-7" aria-hidden /> : <MessageSquareWarning className="size-7" aria-hidden />}
          </div>
          <h1 className="font-heading text-xl font-bold text-white">
            {approved ? "Material aprovado!" : "Pedido de alteração enviado"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {approved
              ? "Registramos a sua aprovação e avisamos a equipe da Luvi."
              : "A equipe da Luvi foi avisada e enviará uma nova versão em breve."}{" "}
            Este link foi encerrado e não pode mais ser usado.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="font-heading text-xl font-bold text-white sm:text-2xl">{material.title}</h1>
        <p className="text-sm text-muted-foreground">
          {client.name} · {project.name}
        </p>
      </div>
      <MaterialReview
        material={material}
        client={client}
        project={project}
        initialComments={comments}
        initialDecisions={decisions}
        mode="link"
        actor={{ name: approverName, role: "cliente" }}
        compact
        onStatusChange={(status) => {
          setResult(status);
          setStep("concluido");
        }}
      />
    </div>
  );
}
