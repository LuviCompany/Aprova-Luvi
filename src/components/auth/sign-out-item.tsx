"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";
import { signOutAction } from "@/app/login/actions";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

/** Item "Sair" dos menus de usuário: encerra a sessão no servidor e volta ao login. */
export function SignOutMenuItem() {
  const [pending, startTransition] = useTransition();
  return (
    <DropdownMenuItem disabled={pending} onClick={() => startTransition(() => signOutAction())}>
      <LogOut /> {pending ? "Saindo…" : "Sair"}
    </DropdownMenuItem>
  );
}
