export type AppRole = "admin" | "designer" | "atendimento" | "cliente";

export const STAFF_ROLES: readonly AppRole[] = ["admin", "designer", "atendimento"];

export const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Administrador",
  designer: "Designer",
  atendimento: "Atendimento",
  cliente: "Cliente",
};

export function isAppRole(value: unknown): value is AppRole {
  return value === "admin" || value === "designer" || value === "atendimento" || value === "cliente";
}

export function isStaffRole(role: AppRole): boolean {
  return STAFF_ROLES.includes(role);
}

/** Tela inicial de cada perfil depois do login. */
export function homeForRole(role: AppRole): string {
  return isStaffRole(role) ? "/admin" : "/portal";
}

/** Raiz de rota que cada perfil pode abrir. A decisão final é sempre do servidor (DAL + RLS). */
export function canAccessPath(role: AppRole, pathname: string): boolean {
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return isStaffRole(role);
  if (pathname === "/portal" || pathname.startsWith("/portal/")) return role === "cliente";
  return true;
}

/** Rotas que exigem sessão. /aprovar usa token próprio, sem login. */
export function isProtectedPath(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/portal" ||
    pathname.startsWith("/portal/") ||
    pathname === "/redefinir-senha"
  );
}
