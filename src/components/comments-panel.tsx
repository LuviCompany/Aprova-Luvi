"use client";

import { useId, useState, type FormEvent } from "react";
import { MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/native-select";
import { formatDateTime } from "@/lib/format";
import type { Comment } from "@/lib/types";
import { cn } from "@/lib/utils";

interface CommentsPanelProps {
  comments: Comment[];
  totalSlides: number;
  authorName: string;
  authorRole: Comment["authorRole"];
  /** Slide destacado na prévia; novos comentários partem dele. */
  currentSlide?: number;
  onAdd: (slide: number | null, body: string) => void;
}

export function CommentsPanel({
  comments,
  totalSlides,
  authorName,
  authorRole,
  currentSlide,
  onAdd,
}: CommentsPanelProps) {
  const id = useId();
  const [target, setTarget] = useState<string>("geral");
  const [body, setBody] = useState("");
  const [filter, setFilter] = useState<"todos" | "geral" | number>("todos");

  const hasSlides = totalSlides > 1;
  const visible = comments
    .filter((c) => filter === "todos" || (filter === "geral" ? c.slide === null : c.slide === filter))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = body.trim();
    if (!text) return;
    onAdd(target === "geral" ? null : Number(target), text);
    setBody("");
  };

  const slidesWithComments = Array.from(
    new Set(comments.map((c) => c.slide).filter((s): s is number => s !== null)),
  ).sort((a, b) => a - b);

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="flex items-center gap-2 font-heading text-base font-bold text-white">
          <MessageSquare className="size-4 text-primary" aria-hidden />
          Comentários
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {comments.length}
          </span>
        </h2>
      </div>

      {hasSlides && comments.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar comentários">
          {(["todos", "geral", ...slidesWithComments] as const).map((f) => (
            <button
              key={String(f)}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                filter === f
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-white/10 text-muted-foreground hover:text-white",
              )}
            >
              {f === "todos" ? "Todos" : f === "geral" ? "Geral" : `Slide ${f}`}
            </button>
          ))}
        </div>
      )}

      <ul className="flex flex-col gap-3" data-testid="comment-list">
        {visible.length === 0 && (
          <li className="rounded-xl border border-dashed border-white/10 p-4 text-center text-sm text-muted-foreground">
            Nenhum comentário ainda.
          </li>
        )}
        {visible.map((c) => (
          <li
            key={c.id}
            className={cn(
              "rounded-xl border p-3 text-sm",
              c.authorRole === "luvi" ? "border-primary/25 bg-primary/5" : "border-white/10 bg-white/[0.03]",
            )}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="font-semibold text-white">{c.author}</span>
              <span>{c.authorRole === "luvi" ? "Luvi" : "Cliente"}</span>
              <span aria-hidden>·</span>
              <time dateTime={c.createdAt}>{formatDateTime(c.createdAt)}</time>
              <span className="ml-auto rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] text-white">
                {c.slide === null ? "Geral" : `Slide ${c.slide}`}
              </span>
            </div>
            <p className="mt-1.5 text-foreground">{c.body}</p>
          </li>
        ))}
      </ul>

      <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-white/10 p-3">
        <p className="text-xs text-muted-foreground">
          Comentando como <span className="font-semibold text-white">{authorName}</span>
          {authorRole === "luvi" ? " (Luvi)" : ""}
        </p>
        {hasSlides && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-target`}>Sobre</Label>
            <NativeSelect id={`${id}-target`} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="geral">Material inteiro</option>
              {Array.from({ length: totalSlides }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  Slide {n}
                  {currentSlide === n ? " (em exibição)" : ""}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-body`}>Novo comentário</Label>
          <Textarea
            id={`${id}-body`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Descreva o ajuste ou deixe um recado…"
            rows={3}
          />
        </div>
        <Button type="submit" disabled={!body.trim()} className="self-end">
          <Send data-icon="inline-start" /> Comentar
        </Button>
      </form>
    </section>
  );
}
