"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import {
  Bell,
  Building2,
  CheckCheck,
  FolderKanban,
  Images,
  LayoutDashboard,
  LogOut,
  Menu,
  Users,
} from "lucide-react";
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
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export const ADMIN_NAV = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/clientes", label: "Clientes", icon: Building2 },
  { href: "/admin/projetos", label: "Projetos", icon: FolderKanban },
  { href: "/admin/materiais", label: "Materiais", icon: Images },
  { href: "/admin/historico", label: "Histórico", icon: CheckCheck },
  { href: "/admin/usuarios", label: "Usuários", icon: Users },
] as const;

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Navegação do painel" className="flex flex-col gap-1">
      {ADMIN_NAV.map(({ href, label, icon: Icon, ...rest }) => {
        const active = "exact" in rest && rest.exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              active
                ? "bg-primary text-primary-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-white",
            )}
          >
            <Icon className="size-4.5" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function NavFallback() {
  return <div aria-hidden className="h-72 animate-pulse rounded-xl bg-white/[0.03]" />;
}

export function AdminShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
      <a href="#conteudo" className="skip-link">
        Pular para o conteúdo
      </a>

      <aside className="sticky top-0 hidden h-screen flex-col gap-6 border-r border-sidebar-border bg-sidebar p-4 lg:flex">
        <Link href="/admin" className="px-2 pt-2" aria-label="Aprova Luvi — início do painel">
          <Logo size="sm" />
        </Link>
        <Suspense fallback={<NavFallback />}>
          <NavList />
        </Suspense>
        <p className="mt-auto px-2 text-xs text-muted-foreground">
          Fase 1 · dados fictícios
        </p>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-white/10 bg-background/80 px-4 backdrop-blur-md sm:px-6">
          <Button
            variant="outline"
            size="icon"
            className="lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Abrir menu"
          >
            <Menu />
          </Button>
          <Link href="/admin" className="lg:hidden" aria-label="Aprova Luvi">
            <Logo size="sm" withProductName={false} />
          </Link>

          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="icon" aria-label="Notificações" className="relative">
              <Bell />
              <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary" aria-hidden />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Menu do usuário"
                className="flex items-center gap-2 rounded-full p-1 pr-3 outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Avatar className="size-8">
                  <AvatarFallback className="bg-primary text-xs font-bold text-primary-foreground">EN</AvatarFallback>
                </Avatar>
                <span className="hidden text-sm font-medium sm:inline">Enzo</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>enzo@luvicompany.example</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem render={<Link href="/login" />}>
                  <LogOut /> Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main id="conteudo" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 bg-sidebar p-4">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">Navegação do painel administrativo</SheetDescription>
          <div className="mb-6 px-2 pt-2">
            <Logo size="sm" />
          </div>
          <Suspense fallback={<NavFallback />}>
            <NavList onNavigate={() => setOpen(false)} />
          </Suspense>
        </SheetContent>
      </Sheet>
    </div>
  );
}
