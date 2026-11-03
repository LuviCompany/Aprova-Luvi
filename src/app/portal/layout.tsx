import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { MockDataNotice } from "@/components/interim-data-notice";
import { ShellSkeleton } from "@/components/page-skeleton";
import { PortalShell } from "@/components/portal/portal-shell";
import { getPortalContext } from "@/lib/auth/portal-context";
import { requireClientUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: { default: "Portal do cliente", template: "%s · Aprova Luvi" } };

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <PortalGate>{children}</PortalGate>
    </Suspense>
  );
}

/** Autorização no servidor: só aprovador ativo, vinculado a um cliente, chega ao portal. */
async function PortalGate({ children }: { children: ReactNode }) {
  const user = await requireClientUser();
  const context = await getPortalContext(user);
  if (!context) redirect("/login?erro=sem-acesso");

  return (
    <PortalShell clientName={context.clientName} approverName={user.name} approverEmail={user.email}>
      <MockDataNotice until="no Módulo 4" />
      {children}
    </PortalShell>
  );
}
