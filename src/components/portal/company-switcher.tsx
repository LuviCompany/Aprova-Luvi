"use client";

import { useState, useTransition } from "react";
import { Building2, Check, ChevronDown } from "lucide-react";
import { selectCompanyAction } from "@/app/portal/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PortalLink } from "@/lib/auth/portal-selection";

interface CompanySwitcherProps {
  links: PortalLink[];
  activeClientId: string;
}

/** Troca de empresa no cabeçalho do portal (só existe quando há mais de um vínculo ativo). */
export function CompanySwitcher({ links, activeClientId }: CompanySwitcherProps) {
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const active = links.find((link) => link.clientId === activeClientId);

  const choose = (clientId: string) => {
    if (clientId === activeClientId) return;
    setError(null);
    startTransition(async () => {
      const result = await selectCompanyAction(clientId);
      if (!result.ok) setError(result.error ?? "Não foi possível trocar de empresa.");
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Trocar empresa"
        className="flex max-w-48 items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-sm outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{active?.clientName ?? "Empresa"}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Empresa</DropdownMenuLabel>
        </DropdownMenuGroup>
        {links.map((link) => (
          <DropdownMenuItem key={link.clientId} onClick={() => choose(link.clientId)}>
            {link.clientId === activeClientId ? <Check aria-hidden /> : <span className="size-4" aria-hidden />}
            {link.clientName}
          </DropdownMenuItem>
        ))}
        {error && (
          <p role="alert" className="px-2 py-1.5 text-xs text-destructive">
            {error}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
