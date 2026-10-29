import { CheckCircle2, MessageSquareWarning, History } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import type { Decision, MaterialVersion } from "@/lib/types";
import { cn } from "@/lib/utils";

interface VersionHistoryProps {
  versions: MaterialVersion[];
  decisions: Decision[];
}

/** Linha do tempo de versões, com a decisão registrada em cada uma. Nunca apaga histórico. */
export function VersionHistory({ versions, decisions }: VersionHistoryProps) {
  const ordered = [...versions].sort((a, b) => b.number - a.number);
  const current = ordered[0]?.number;

  return (
    <section aria-label="Histórico de versões" className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 font-heading text-base font-bold text-white">
        <History className="size-4 text-primary" aria-hidden /> Histórico de versões
      </h2>
      <ol className="relative flex flex-col gap-4 border-l border-white/10 pl-5">
        {ordered.map((v) => {
          const decision = decisions
            .filter((d) => d.version === v.number)
            .sort((a, b) => b.at.localeCompare(a.at))[0];
          return (
            <li key={v.number} className="relative">
              <span
                aria-hidden
                className={cn(
                  "absolute top-1.5 -left-[25px] size-2.5 rounded-full",
                  v.number === current ? "bg-primary ring-4 ring-primary/20" : "bg-white/30",
                )}
              />
              <p className="text-sm font-semibold text-white">
                Versão {v.number}
                {v.number === current && (
                  <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                    Atual
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {v.author} · <time dateTime={v.createdAt}>{formatDateTime(v.createdAt)}</time>
              </p>
              <p className="mt-0.5 text-sm text-foreground">{v.note}</p>
              {decision && (
                <p
                  className={cn(
                    "mt-1.5 inline-flex items-start gap-1.5 rounded-lg px-2 py-1 text-xs",
                    decision.decision === "aprovado" ? "bg-success/10 text-success" : "bg-primary/10 text-primary",
                  )}
                >
                  {decision.decision === "aprovado" ? (
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  ) : (
                    <MessageSquareWarning className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  )}
                  <span>
                    {decision.decision === "aprovado" ? "Aprovada" : "Alteração solicitada"} por {decision.by}{" "}
                    ({decision.via === "link" ? "link seguro" : "portal"}) em {formatDateTime(decision.at)}
                    {decision.note ? ` — “${decision.note}”` : ""}
                  </span>
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
