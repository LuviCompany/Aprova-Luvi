import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  tone?: "default" | "primary" | "success" | "warning";
}

const TONE: Record<NonNullable<KpiCardProps["tone"]>, string> = {
  default: "bg-white/5 text-white",
  primary: "bg-primary/15 text-primary",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
};

export function KpiCard({ label, value, hint, icon: Icon, tone = "default" }: KpiCardProps) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 font-heading text-3xl font-bold text-white" data-testid="kpi-value">
            {value}
          </p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", TONE[tone])}>
          <Icon className="size-5" aria-hidden />
        </span>
      </CardContent>
    </Card>
  );
}
