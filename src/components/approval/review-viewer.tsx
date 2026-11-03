"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReviewFile } from "@/lib/approval/review";
import { cn } from "@/lib/utils";

/**
 * Visualização do material enviado: imagem, vídeo, PDF ou carrossel com navegação entre slides. Os arquivos
 * vêm SEMPRE de uma rota protegida (`fileBase`/<id>), que confere o acesso e redireciona para uma URL assinada
 * de 60 s: a página nunca carrega o endereço do storage.
 */
export function ReviewViewer({
  files,
  fileBase,
  onSlideChange,
}: {
  files: ReviewFile[];
  fileBase: string;
  onSlideChange?: (slide: number) => void;
}) {
  const [index, setIndex] = useState(0);
  const total = files.length;
  if (total === 0) {
    return (
      <p className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-muted-foreground">
        Este material não tem arquivos.
      </p>
    );
  }
  const current = files[Math.min(index, total - 1)];
  const src = `${fileBase}/${current.id}`;

  const go = (next: number) => {
    const bounded = Math.max(0, Math.min(total - 1, next));
    setIndex(bounded);
    onSlideChange?.(bounded + 1);
  };

  return (
    <section aria-label="Prévia do material" className="flex flex-col gap-3">
      <div className="flex min-h-72 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/40">
        {current.kind === "imagem" && (
          // eslint-disable-next-line @next/next/no-img-element -- rota protegida que redireciona; o otimizador não a alcança
          <img src={src} alt={current.originalName} className="max-h-[70vh] w-full object-contain" />
        )}
        {current.kind === "video" && (
          <video src={src} controls preload="metadata" aria-label={current.originalName} className="max-h-[70vh] w-full object-contain" />
        )}
        {current.kind === "pdf" && (
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground hover:text-white"
          >
            <FileText className="size-10" aria-hidden />
            Abrir PDF em nova aba
            <span className="text-xs">{current.originalName}</span>
          </a>
        )}
      </div>

      {total > 1 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Slide anterior">
              <ChevronLeft data-icon="inline-start" /> Anterior
            </Button>
            <p aria-live="polite" className="text-sm text-muted-foreground" data-testid="slide-position">
              Slide {index + 1} de {total}
            </p>
            <Button variant="outline" size="sm" onClick={() => go(index + 1)} disabled={index === total - 1} aria-label="Próximo slide">
              Próximo <ChevronRight data-icon="inline-end" />
            </Button>
          </div>
          <ol className="flex flex-wrap gap-1.5" aria-label="Slides">
            {files.map((file, i) => (
              <li key={file.id}>
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-label={`Ir para o slide ${i + 1}`}
                  aria-current={i === index ? "true" : undefined}
                  className={cn(
                    "size-8 rounded-md border text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    i === index ? "border-primary bg-primary/15 text-primary" : "border-white/10 text-muted-foreground hover:text-white",
                  )}
                >
                  {i + 1}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
