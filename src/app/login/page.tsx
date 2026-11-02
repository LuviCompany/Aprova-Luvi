import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthLayout, Notice } from "@/components/auth/auth-layout";
import { LoginForm } from "@/components/login-form";
import { MESSAGES } from "@/lib/auth/errors";
import { safeNextPath } from "@/lib/auth/redirect";
import { homeForRole } from "@/lib/auth/roles";
import { getSessionUser } from "@/lib/auth/session";
import { isDemoMode, isSupabaseConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Entrar" };

const ERRORS: Record<string, string> = {
  "sem-acesso": MESSAGES.noAccess,
  "link-invalido": MESSAGES.expiredLink,
  config: MESSAGES.notConfigured,
};

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <Suspense fallback={<AuthLayout title="Bem-vindo de volta" description="Carregando…">{null}</AuthLayout>}>
      <LoginContent searchParams={searchParams} />
    </Suspense>
  );
}

async function LoginContent({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  // Lê a requisição ANTES do ambiente: assim o modo (demo/real) é decidido a cada acesso,
  // nunca congelado no build.
  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const demo = isDemoMode();

  if (!demo) {
    const user = await getSessionUser();
    if (user) redirect(homeForRole(user.role));
  }

  const erro = first(params.erro);
  const msg = first(params.msg);
  const next = safeNextPath(first(params.next), "");

  return (
    <AuthLayout
      title="Bem-vindo de volta"
      description="Acesse para acompanhar e aprovar seus materiais."
      footer={
        demo ? (
          <>
            Veja uma{" "}
            <Link href="/aprovar/demo" className="text-white underline underline-offset-4 hover:text-primary">
              demonstração da aprovação rápida
            </Link>
            .
          </>
        ) : undefined
      }
    >
      {!demo && !isSupabaseConfigured() && <Notice tone="error">{MESSAGES.notConfigured}</Notice>}
      {erro && ERRORS[erro] && <Notice tone="error">{ERRORS[erro]}</Notice>}
      {msg === "senha-redefinida" && <Notice tone="success">Senha alterada. Entre com a nova senha.</Notice>}
      <LoginForm mode={demo ? "demo" : "real"} next={next || undefined} />
    </AuthLayout>
  );
}
