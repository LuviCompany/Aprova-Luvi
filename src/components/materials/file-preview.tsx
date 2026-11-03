import { FileText } from "lucide-react";
import type { VersionFile } from "@/lib/materials/versions";
import { cn } from "@/lib/utils";

/**
 * Pré-visualização de um arquivo pela rota protegida `/admin/arquivos/[id]` (nunca por endereço do storage).
 * Imagem e vídeo aparecem na página; PDF abre em outra aba.
 */
export function FilePreview({ file, className }: { file: Pick<VersionFile, "id" | "kind" | "originalName">; className?: string }) {
  const src = `/admin/arquivos/${file.id}`;
  const frame = "overflow-hidden rounded-lg border border-white/10 bg-black/40";
  if (file.kind === "imagem") {
    return (
      <div className={cn(frame, className)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a URL é uma rota protegida que redireciona; o otimizador não tem como buscá-la */}
        <img src={src} alt={file.originalName} loading="lazy" className="size-full object-contain" />
      </div>
    );
  }
  if (file.kind === "video") {
    return (
      <div className={cn(frame, className)}>
        <video src={src} controls preload="metadata" aria-label={file.originalName} className="size-full object-contain" />
      </div>
    );
  }
  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(frame, "flex flex-col items-center justify-center gap-1 p-3 text-center text-xs text-muted-foreground hover:text-white", className)}
    >
      <FileText className="size-6" aria-hidden />
      Abrir PDF
      <span className="sr-only"> {file.originalName} em nova aba</span>
    </a>
  );
}
