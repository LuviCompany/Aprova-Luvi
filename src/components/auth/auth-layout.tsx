import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";

interface AuthLayoutProps {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}

/** Moldura das telas públicas de autenticação (login, recuperação e redefinição de senha). */
export function AuthLayout({ title, description, children, footer }: AuthLayoutProps) {
  return (
    <main className="luvi-glow flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo size="lg" />
        </div>
        <div className="rounded-3xl border border-white/10 bg-card/90 p-6 shadow-2xl shadow-black/50 backdrop-blur sm:p-8">
          <h1 className="font-heading text-2xl font-bold text-white">{title}</h1>
          <p className="mt-1 mb-6 text-sm text-muted-foreground">{description}</p>
          {children}
        </div>
        {footer && <div className="mt-6 text-center text-xs text-muted-foreground">{footer}</div>}
      </div>
    </main>
  );
}

export function Notice({ tone, children }: { tone: "error" | "success" | "info" | "warning"; children: ReactNode }) {
  const styles = {
    error: "border-destructive/30 bg-destructive/10 text-destructive",
    success: "border-success/30 bg-success/10 text-success",
    info: "border-white/10 bg-white/[0.03] text-muted-foreground",
    warning: "border-warning/30 bg-warning/10 text-warning",
  } as const;
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`mb-4 rounded-xl border px-3 py-2.5 text-sm ${styles[tone]}`}
    >
      {children}
    </p>
  );
}
