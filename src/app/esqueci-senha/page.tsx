import type { Metadata } from "next";
import { AuthLayout } from "@/components/auth/auth-layout";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Recuperar senha" };

export default function ForgotPasswordPage() {
  return (
    <AuthLayout
      title="Recuperar senha"
      description="Informe seu e-mail e enviaremos um link para criar uma nova senha."
    >
      <ForgotPasswordForm />
    </AuthLayout>
  );
}
