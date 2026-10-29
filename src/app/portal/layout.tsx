import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PortalShell } from "@/components/portal/portal-shell";
import { CURRENT_PORTAL_APPROVER_ID, CURRENT_PORTAL_CLIENT_ID, clients } from "@/lib/mock/data";

export const metadata: Metadata = { title: { default: "Portal do cliente", template: "%s · Aprova Luvi" } };

export default function PortalLayout({ children }: { children: ReactNode }) {
  const client = clients.find((c) => c.id === CURRENT_PORTAL_CLIENT_ID)!;
  const approver = client.approvers.find((a) => a.id === CURRENT_PORTAL_APPROVER_ID)!;
  return (
    <PortalShell clientName={client.name} approverName={approver.name} approverEmail={approver.email}>
      {children}
    </PortalShell>
  );
}
