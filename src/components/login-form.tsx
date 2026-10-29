"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Audience = "luvi" | "cliente";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLogin(email: string, password: string): { email?: string; password?: string } {
  const errors: { email?: string; password?: string } = {};
  if (!EMAIL_PATTERN.test(email.trim())) errors.email = "Informe um e-mail válido.";
  if (password.length < 6) errors.password = "A senha deve ter ao menos 6 caracteres.";
  return errors;
}

export function LoginForm() {
  const router = useRouter();
  const id = useId();
  const [audience, setAudience] = useState<Audience>("luvi");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = validateLogin(email, password);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    // Fase 1: sem autenticação real. Na Fase 2 isto vira Supabase Auth + redirecionamento por papel.
    router.push(audience === "luvi" ? "/admin" : "/portal");
  };

  return (
    <div className="flex flex-col gap-6">
      <Tabs value={audience} onValueChange={(v) => setAudience(v as Audience)}>
        <TabsList className="w-full">
          <TabsTrigger value="luvi" className="flex-1">
            Equipe Luvi
          </TabsTrigger>
          <TabsTrigger value="cliente" className="flex-1">
            Sou cliente
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-email`}>E-mail</Label>
          <Input
            id={`${id}-email`}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={audience === "luvi" ? "voce@luvicompany.com.br" : "voce@suaempresa.com.br"}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? `${id}-email-error` : undefined}
            className="h-11"
          />
          {errors.email && (
            <p id={`${id}-email-error`} role="alert" className="text-xs text-destructive">
              {errors.email}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor={`${id}-password`}>Senha</Label>
            <Link href="#" className="text-xs text-muted-foreground underline-offset-4 hover:text-primary hover:underline">
              Esqueci minha senha
            </Link>
          </div>
          <Input
            id={`${id}-password`}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? `${id}-password-error` : undefined}
            className="h-11"
          />
          {errors.password && (
            <p id={`${id}-password-error`} role="alert" className="text-xs text-destructive">
              {errors.password}
            </p>
          )}
        </div>
        <Button type="submit" size="lg" className="mt-2">
          Entrar <ArrowRight data-icon="inline-end" />
        </Button>
      </form>

      <p className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span>
          Ambiente de demonstração (Fase 1): qualquer e-mail válido e senha com 6+ caracteres entram, sem
          verificação real. Recebeu um link de aprovação por e-mail? Basta abri-lo, sem precisar de login.
        </span>
      </p>
    </div>
  );
}
