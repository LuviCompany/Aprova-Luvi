"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Material } from "@/lib/types";
import { cn } from "@/lib/utils";

const SLIDE_BACKGROUNDS = [
  "from-primary to-[#7a1d00]",
  "from-surface-2 to-ink",
  "from-[#cc2f00] to-surface",
  "from-ink to-primary/60",
  "from-surface to-[#ff3b00]/70",
  "from-[#2a2a2a] to-[#ff3b00]/40",
];

const ASPECT: Record<Material["type"], string> = {
  imagem: "aspect-[4/5]",
  carrossel: "aspect-square",
  video: "aspect-video",
  pdf: "aspect-[3/4]",
};

interface MaterialViewerProps {
  material: Material;
  /** Slide selecionado (controlado pelo pai para ligar com os comentários). */
  slide?: number;
  onSlideChange?: (slide: number) => void;
}

/**
 * Prévia do material. Na Fase 1 renderiza uma arte fictícia; na Fase 2 recebe
 * URLs assinadas do Supabase Storage (bucket privado).
 */
export function MaterialViewer({ material, slide: controlled, onSlideChange }: MaterialViewerProps) {
  const [internal, setInternal] = useState(1);
  const slide = controlled ?? internal;
  const total = material.type === "carrossel" || material.type === "pdf" ? material.slides : 1;

  const go = (next: number) => {
    const clamped = Math.min(total, Math.max(1, next));
    setInternal(clamped);
    onSlideChange?.(clamped);
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          "relative mx-auto flex w-full max-w-xl items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br p-6 text-center",
          ASPECT[material.type],
          SLIDE_BACKGROUNDS[(slide - 1) % SLIDE_BACKGROUNDS.length],
        )}
        role="img"
        aria-label={`Prévia fictícia: ${material.title}${total > 1 ? `, ${slide} de ${total}` : ""}`}
        data-testid="material-preview"
      >
        <div className="flex flex-col items-center gap-3">
          {material.type === "video" && (
            <span className="flex size-16 items-center justify-center rounded-full bg-white/90 text-ink">
              <Play className="size-7 translate-x-0.5" aria-hidden />
            </span>
          )}
          {material.type === "pdf" && <FileText className="size-12 text-white/90" aria-hidden />}
          <p className="font-heading text-xl font-extrabold text-white drop-shadow sm:text-2xl">
            {material.title}
          </p>
          <p className="text-xs uppercase tracking-widest text-white/70">Prévia fictícia · {material.channel}</p>
        </div>
        {total > 1 && (
          <span className="absolute top-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white">
            {slide}/{total}
          </span>
        )}
      </div>

      {total > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="icon" onClick={() => go(slide - 1)} disabled={slide <= 1} aria-label="Slide anterior">
            <ChevronLeft />
          </Button>
          <div className="flex items-center gap-1.5" role="group" aria-label="Selecionar slide">
            {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => go(n)}
                aria-label={`Ir para o slide ${n}`}
                aria-current={n === slide}
                className={cn(
                  "size-2.5 rounded-full transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  n === slide ? "w-6 bg-primary" : "bg-white/25 hover:bg-white/50",
                )}
              />
            ))}
          </div>
          <Button variant="outline" size="icon" onClick={() => go(slide + 1)} disabled={slide >= total} aria-label="Próximo slide">
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}
