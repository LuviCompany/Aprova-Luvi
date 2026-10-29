import { CheckCircle2, Clock, FileText, MessageSquareWarning } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL, TYPE_LABEL } from "@/lib/domain";
import type { MaterialStatus, MaterialType } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<MaterialStatus, { className: string; icon: typeof Clock }> = {
  rascunho: { className: "border-white/15 bg-white/5 text-muted-foreground", icon: FileText },
  aguardando: { className: "border-warning/30 bg-warning/10 text-warning", icon: Clock },
  alteracao: { className: "border-primary/40 bg-primary/10 text-primary", icon: MessageSquareWarning },
  aprovado: { className: "border-success/30 bg-success/10 text-success", icon: CheckCircle2 },
};

export function StatusBadge({ status, className }: { status: MaterialStatus; className?: string }) {
  const { className: style, icon: Icon } = STATUS_STYLE[status];
  return (
    <Badge variant="outline" className={cn("gap-1 whitespace-nowrap", style, className)}>
      <Icon className="size-3" aria-hidden />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function TypeBadge({ type }: { type: MaterialType }) {
  return (
    <Badge variant="secondary" className="whitespace-nowrap">
      {TYPE_LABEL[type]}
    </Badge>
  );
}
