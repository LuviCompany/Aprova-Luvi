"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Bell, LogOut } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/portal", label: "Início", exact: true },
  { href: "/portal/materiais", label: "Materiais" },
  { href: "/portal/historico", label: "Histórico" },
] as const;

interface PortalShellProps {
  clientName: string;
  approverName: string;
  approverEmail: string;
  children: ReactNode;
}

function PortalNav({ variant }: { variant: "desktop" | "mobile" }) {
  const pathname = usePathname();
  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname.startsWith(href));
  if (variant === "desktop") {
    return (
      <nav aria-label="Navegação do portal" className="ml-4 hidden items-center gap-1 md:flex">
        {NAV.map(({ href, label, ...rest }) => {
          const active = isActive(href, "exact" in rest ? rest.exact : false);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                active ? "bg-white/10 text-white" : "text-muted-foreground hover:text-white",
              )}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    );
  }
  return (
    <nav aria-label="Navegação do portal (celular)" className="flex gap-1 overflow-x-auto border-t border-white/5 px-4 py-2 md:hidden">
      {NAV.map(({ href, label, ...rest }) => {
        const active = isActive(href, "exact" in rest ? rest.exact : false);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium whitespace-nowrap",
              active ? "bg-white/10 text-white" : "text-muted-foreground",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function PortalShell({ clientName, approverName, approverEmail, children }: PortalShellProps) {
  const initials = approverName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#conteudo" className="skip-link">
        Pular para o conteúdo
      </a>
      <header className="sticky top-0 z-30 border-b border-white/10 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link href="/portal" aria-label="Aprova Luvi — início">
            <Logo size="sm" />
          </Link>
          <Suspense fallback={null}>
            <PortalNav variant="desktop" />
          </Suspense>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="icon" aria-label="Notificações">
              <Bell />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Menu do usuário"
                className="flex items-center gap-2 rounded-full p-1 pr-3 outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Avatar className="size-8">
                  <AvatarFallback className="bg-primary text-xs font-bold text-primary-foreground">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden text-sm font-medium sm:inline">{approverName}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel>
                  {clientName}
                  <span className="block text-xs font-normal text-muted-foreground">{approverEmail}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem render={<Link href="/login" />}>
                  <LogOut /> Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <Suspense fallback={<div aria-hidden className="h-12 border-t border-white/5 md:hidden" />}>
          <PortalNav variant="mobile" />
        </Suspense>
      </header>
      <main id="conteudo" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
      <footer className="border-t border-white/10 py-6 text-center text-xs text-muted-foreground">
        Aprova Luvi · Luvi Company
      </footer>
    </div>
  );
}
