"use client";

import { useState, useTransition } from "react";
import { Building2, Loader2 } from "lucide-react";
import { selectCompanyAction } from "@/app/portal/actions";
import { signOutAction } from "@/app/login/actions";
import { AuthLayout, Notice } from "@/components/auth/auth-layout";
import { Button } from "@/components/ui/button";
import type { PortalLink } from "@/lib/auth/portal-selection";

/**
 * Escolha obrigatória da empresa quando o aprovador tem vínculos ativos com mais de uma. O sistema
 * nunca escolhe por ele: enquanto não houver escolha válida, nenhuma tela do portal é aberta.
 */
export function CompanyPicker({ links }: { links: PortalLink[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const choose = (clientId: string) => {
    setPendingId(clientId);
    startTransition(async () => {
      const result = await selectCompanyAction(clientId);
      if (!result.ok) {
        setError(result.error ?? "Não foi possível escolher a empresa. Tente novamente.");
        setPendingId(null);
      }
    });
  };

  return (
    <AuthLayout
      title="Escolha a empresa"
      description="Sua conta aprova materiais de mais de uma empresa. Escolha qual você quer acompanhar agora; dá para trocar depois pelo menu."
      footer={
        <form action={signOutAction}>
          <button type="submit" className="underline underline-offset-4 hover:text-white">
            Sair
          </button>
        </form>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      <ul className="flex flex-col gap-2">
        {links.map((link) => (
          <li key={link.clientId}>
            <Button
              variant="outline"
              size="lg"
              className="w-full justify-start"
              disabled={pending}
              onClick={() => choose(link.clientId)}
            >
              {pendingId === link.clientId ? (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              ) : (
                <Building2 data-icon="inline-start" />
              )}
              {link.clientName}
            </Button>
          </li>
        ))}
      </ul>
    </AuthLayout>
  );
}
