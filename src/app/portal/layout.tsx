import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { ShellSkeleton } from "@/components/page-skeleton";
import { PortalShell } from "@/components/portal/portal-shell";
import { CompanyPicker } from "@/components/portal/company-picker";
import { resolvePortalContext } from "@/lib/auth/portal-context";
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
  const resolution = await resolvePortalContext(user);
  if (resolution.kind === "none") redirect("/login?erro=sem-acesso");
  // Vários vínculos e nenhuma escolha válida: o usuário escolhe; o sistema nunca pega "o primeiro".
  if (resolution.kind === "choose") return <CompanyPicker links={resolution.links} />;
  const { context, links } = resolution;

  return (
    <PortalShell
      clientName={context.clientName}
      approverName={user.name}
      approverEmail={user.email}
      companies={links}
      activeClientId={context.clientId}
    >
      {children}
    </PortalShell>
  );
}
