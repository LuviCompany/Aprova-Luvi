import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { ShellSkeleton } from "@/components/page-skeleton";
import { ROLE_LABEL } from "@/lib/auth/roles";
import { requireStaff } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/env";

export const metadata: Metadata = { title: { default: "Painel", template: "%s · Painel · Aprova Luvi" } };

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AdminGate>{children}</AdminGate>
    </Suspense>
  );
}

/** Autorização no servidor: só equipe ativa chega às telas do painel. */
async function AdminGate({ children }: { children: ReactNode }) {
  const user = await requireStaff();
  return (
    <AdminShell
      demo={isDemoMode()}
      isAdmin={user.role === "admin"}
      user={{ name: user.name, email: user.email, initials: user.initials, roleLabel: ROLE_LABEL[user.role] }}
    >
      {children}
    </AdminShell>
  );
}
