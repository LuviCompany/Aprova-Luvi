import { FilePreview } from "@/components/materials/file-preview";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { KIND_LABEL, formatBytes } from "@/lib/materials/files";
import { ASPECT_RATIO_LABEL, type AspectRatio } from "@/lib/materials/schema";
import type { MaterialVersionItem } from "@/lib/materials/versions";
import { TYPE_LABEL } from "@/lib/domain";
import type { MaterialType } from "@/lib/types";

/** Histórico de versões (imutável): cada versão mostra a nota, os arquivos e o conteúdo congelado. */
export function VersionsHistory({ versions }: { versions: MaterialVersionItem[] }) {
  if (versions.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma versão ainda. A versão 1 nasce no primeiro envio de arquivo.</p>;
  }
  return (
    <ol className="flex flex-col gap-2" aria-label="Versões do material">
      {versions.map((version, index) => (
        <li key={version.id}>
          <details className="group rounded-xl border border-white/10 bg-white/[0.02]" open={index === 0 && versions.length === 1}>
            <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <span className="font-heading font-bold text-white">Versão {version.number}</span>
              {index === 0 && <Badge variant="secondary">Mais recente</Badge>}
              {version.sent ? (
                <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">
                  Enviada
                </Badge>
              ) : (
                <Badge variant="outline">{version.frozen ? "Congelada" : "Em edição"}</Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {formatDateTime(version.createdAt)}
                {version.author ? ` · ${version.author}` : ""} · {version.files.length} {version.files.length === 1 ? "arquivo" : "arquivos"}
              </span>
            </summary>
            <div className="flex flex-col gap-4 border-t border-white/10 px-3 py-3 text-sm">
              {version.note && (
                <p>
                  <span className="text-xs text-muted-foreground">Nota da versão: </span>
                  <span className="whitespace-pre-wrap text-white">{version.note}</span>
                </p>
              )}
              {version.frozen ? (
                <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2" aria-label={`Conteúdo congelado da versão ${version.number}`}>
                  <Field label="Título" value={version.frozen.content.title} />
                  <Field label="Tipo" value={TYPE_LABEL[version.frozen.content.type as MaterialType] ?? version.frozen.content.type} />
                  <Field label="Canal" value={version.frozen.content.channel || "—"} />
                  <Field
                    label="Proporção"
                    value={version.frozen.content.aspect_ratio ? (ASPECT_RATIO_LABEL[version.frozen.content.aspect_ratio as AspectRatio] ?? version.frozen.content.aspect_ratio) : "—"}
                  />
                  <Field label="Prazo de aprovação" value={version.frozen.content.due_date ?? "—"} />
                  <Field label="Publicação prevista" value={version.frozen.content.publish_date ?? "—"} />
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-muted-foreground">Legenda</dt>
                    <dd className="whitespace-pre-wrap text-white">{version.frozen.content.caption || "Sem legenda."}</dd>
                  </div>
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    Cópia imutável registrada em {formatDateTime(version.frozen.frozenAt)}.
                  </p>
                </dl>
              ) : (
                <p className="text-xs text-muted-foreground">
                  O conteúdo desta versão ainda não foi congelado: vale o que está no material (rascunho). Ele é copiado, de forma imutável, quando a versão
                  é enviada para aprovação ou substituída por outra.
                </p>
              )}
              {version.files.length > 0 ? (
                <ul className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5" aria-label={`Arquivos da versão ${version.number}`}>
                  {version.files.map((file) => (
                    <li key={file.id} className="flex flex-col gap-1">
                      <FilePreview file={file} className="aspect-square w-full" />
                      <p className="truncate text-xs text-muted-foreground" title={file.originalName}>
                        {version.files.length > 1 ? `${file.position}. ` : ""}
                        {file.originalName}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {KIND_LABEL[file.kind]} · {formatBytes(file.sizeBytes)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">Esta versão não tem arquivos.</p>
              )}
            </div>
          </details>
        </li>
      ))}
    </ol>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-white">{value}</dd>
    </div>
  );
}
