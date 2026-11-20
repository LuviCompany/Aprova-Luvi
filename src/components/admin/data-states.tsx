import type { ReactNode } from "react";
import { AlertTriangle, type LucideIcon } from "lucide-react";

/** Estados vazios e de erro das telas do painel: mesmo visual, mensagens que orientam o próximo passo. */

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-12 text-center"
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-white/5 text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="font-heading text-base font-semibold text-white">{title}</p>
      {children && <p className="max-w-md text-sm text-muted-foreground">{children}</p>}
    </div>
  );
}

/** Falha ao carregar os dados (rede, banco). Nada foi alterado; recarregar a página tenta de novo. */
export function LoadErrorState({ what }: { what: string }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-5 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <div>
        <p className="font-semibold text-white">Não foi possível carregar {what} agora.</p>
        <p className="mt-1 text-muted-foreground">Pode ser uma falha momentânea de conexão. Recarregue a página para tentar de novo; nada foi alterado.</p>
      </div>
    </div>
  );
}
