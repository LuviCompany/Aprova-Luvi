import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <main className="luvi-glow flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo size="lg" />
        </div>
        <div className="rounded-3xl border border-white/10 bg-card/90 p-6 shadow-2xl shadow-black/50 backdrop-blur sm:p-8">
          <h1 className="font-heading text-2xl font-bold text-white">Bem-vindo de volta</h1>
          <p className="mt-1 mb-6 text-sm text-muted-foreground">
            Acesse para acompanhar e aprovar seus materiais.
          </p>
          <LoginForm />
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Veja uma{" "}
          <Link href="/aprovar/demo" className="text-white underline underline-offset-4 hover:text-primary">
            demonstração da aprovação rápida
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
