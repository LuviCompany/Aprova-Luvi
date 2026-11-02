import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthLayout } from "@/components/auth/auth-layout";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { requireAnyUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Nova senha" };

export default function ResetPasswordPage() {
  return (
    <AuthLayout title="Criar nova senha" description="Escolha uma senha forte para acessar o Aprova Luvi.">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Verificando o link…</p>}>
        <ResetPasswordGate />
      </Suspense>
    </AuthLayout>
  );
}

/** Só abre o formulário para quem chegou por um link válido (sessão criada em /auth/confirm). */
async function ResetPasswordGate() {
  await requireAnyUser();
  return <ResetPasswordForm />;
}
