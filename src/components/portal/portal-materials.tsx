import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock, Hourglass, MessageSquareWarning } from "lucide-react";
import { TypeBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { PortalBucket, PortalMaterialItem } from "@/lib/approval/portal-queries";
import { formatDate } from "@/lib/format";

export const BUCKET_LABEL: Record<PortalBucket, string> = {
  pendente: "Aguardando sua aprovação",
  aguardando_outros: "Aguardando os outros aprovadores",
  ajustes: "Em ajustes",
  aprovado: "Aprovados",
};

const BUCKET_ICON: Record<PortalBucket, typeof Clock> = {
  pendente: Clock,
  aguardando_outros: Hourglass,
  ajustes: MessageSquareWarning,
  aprovado: CheckCircle2,
};

const BUCKET_TONE: Record<PortalBucket, string> = {
  pendente: "text-warning",
  aguardando_outros: "text-muted-foreground",
  ajustes: "text-primary",
  aprovado: "text-success",
};

const ORDER: PortalBucket[] = ["pendente", "aguardando_outros", "ajustes", "aprovado"];

export function bucketCounts(items: PortalMaterialItem[]): Record<PortalBucket, number> {
  const counts: Record<PortalBucket, number> = { pendente: 0, aguardando_outros: 0, ajustes: 0, aprovado: 0 };
  for (const item of items) counts[item.bucket] += 1;
  return counts;
}

function MaterialCard({ item }: { item: PortalMaterialItem }) {
  return (
    <li>
      <Link
        href={`/portal/materiais/${item.id}`}
        className="group block rounded-2xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Card className="transition-colors group-hover:border-primary/50">
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <TypeBadge type={item.type} />
              <span className="text-xs text-muted-foreground">{item.channel || item.projectName}</span>
            </div>
            <p className="font-heading text-base font-bold text-white">{item.title}</p>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {item.projectName}
                {item.versionNumber ? ` · v${item.versionNumber}` : ""}
                {item.dueDate ? ` · prazo ${formatDate(item.dueDate)}` : ""}
              </span>
              <span className="inline-flex items-center gap-1 font-semibold text-primary">
                {item.bucket === "pendente" ? "Revisar" : "Abrir"}
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </span>
            </div>
          </CardContent>
        </Card>
      </Link>
    </li>
  );
}

/** Materiais agrupados por situação para o aprovador (cada grupo só aparece se tiver itens, exceto os pendentes). */
export function PortalMaterialGroups({ items, only }: { items: PortalMaterialItem[]; only?: PortalBucket }) {
  const buckets = ORDER.filter((bucket) => !only || bucket === only);
  return (
    <div className="flex flex-col gap-8">
      {buckets.map((bucket) => {
        const list = items.filter((item) => item.bucket === bucket);
        if (list.length === 0 && bucket !== "pendente") return null;
        const Icon = BUCKET_ICON[bucket];
        return (
          <section key={bucket} aria-labelledby={`grupo-${bucket}`}>
            <h2 id={`grupo-${bucket}`} className="mb-3 flex items-center gap-2 font-heading text-lg font-bold text-white">
              <Icon className={`size-5 ${BUCKET_TONE[bucket]}`} aria-hidden /> {BUCKET_LABEL[bucket]}
              <Badge variant="secondary">{list.length}</Badge>
            </h2>
            {list.length === 0 ? (
              <Card>
                <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="size-4 text-success" aria-hidden /> Tudo em dia! Nenhum material pendente.
                </CardContent>
              </Card>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2">
                {list.map((item) => (
                  <MaterialCard key={item.id} item={item} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
