import type { WeeklyPoint } from "@/lib/domain";

/** Gráfico de barras agrupadas em CSS puro (sem dependência de biblioteca de gráficos). */
export function WeeklyChart({ data }: { data: WeeklyPoint[] }) {
  const max = Math.max(1, ...data.flatMap((p) => [p.aprovados, p.alteracoes]));
  const summary = data
    .map((p) => `${p.label}: ${p.aprovados} aprovados, ${p.alteracoes} com alteração`)
    .join("; ");

  return (
    <figure>
      <div
        role="img"
        aria-label={`Decisões por semana. ${summary}`}
        className="flex h-44 items-end gap-2 sm:gap-4"
      >
        {data.map((p) => (
          <div key={p.label} className="flex h-full flex-1 flex-col justify-end gap-2">
            <div className="flex flex-1 items-end justify-center gap-1">
              <div
                className="w-full max-w-5 rounded-t-md bg-success/80"
                style={{ height: `${(p.aprovados / max) * 100}%`, minHeight: p.aprovados ? 4 : 0 }}
                title={`${p.aprovados} aprovados`}
              />
              <div
                className="w-full max-w-5 rounded-t-md bg-primary"
                style={{ height: `${(p.alteracoes / max) * 100}%`, minHeight: p.alteracoes ? 4 : 0 }}
                title={`${p.alteracoes} com alteração`}
              />
            </div>
            <span className="truncate text-center text-[11px] text-muted-foreground">{p.label}</span>
          </div>
        ))}
      </div>
      <figcaption className="mt-3 flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-success/80" aria-hidden /> Aprovados
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-primary" aria-hidden /> Alteração solicitada
        </span>
      </figcaption>
    </figure>
  );
}
