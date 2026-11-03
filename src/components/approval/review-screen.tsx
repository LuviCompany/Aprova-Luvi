"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { History, Info } from "lucide-react";
import { toast } from "sonner";
import { Notice } from "@/components/auth/auth-layout";
import { CommentsPanel } from "@/components/comments-panel";
import { DecisionPanel } from "@/components/decision-panel";
import { ReviewViewer } from "@/components/approval/review-viewer";
import { StatusBadge, TypeBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import type { ReviewData } from "@/lib/approval/review";
import { formatDate, formatDateTime } from "@/lib/format";
import type { Comment, MaterialStatus } from "@/lib/types";

export interface ReviewActionResult {
  ok?: boolean;
  error?: string;
}

interface ReviewScreenProps {
  review: ReviewData;
  status: MaterialStatus;
  /** Prefixo da rota protegida de arquivos (a página nunca usa o endereço do storage). */
  fileBase: string;
  /** Só `true` se este aprovador tem solicitação ABERTA na versão exibida. */
  canDecide: boolean;
  /** Texto exibido quando não há decisão a tomar. */
  idleNotice: string;
  approverName: string;
  onDecide: (decision: "aprovado" | "alteracao", note: string) => Promise<ReviewActionResult>;
  /** Sem esta função não há campo de comentário (o link rápido só mostra os comentários da equipe). */
  onComment?: (slide: number | null, body: string) => Promise<ReviewActionResult>;
}

export function ReviewScreen({ review, status, fileBase, canDecide, idleNotice, approverName, onDecide, onComment }: ReviewScreenProps) {
  const router = useRouter();
  const [slide, setSlide] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const comments: Comment[] = review.comments.map((c) => ({
    id: c.id,
    materialId: "",
    slide: c.slide,
    author: c.authorName,
    authorRole: c.authorRole,
    body: c.body,
    createdAt: c.createdAt,
  }));

  const decide = (decision: "aprovado" | "alteracao", note?: string) =>
    startTransition(async () => {
      setError(null);
      const result = await onDecide(decision, note ?? "");
      if (result.ok) {
        toast.success(decision === "aprovado" ? "Aprovação registrada." : "Pedido de alteração enviado.");
        router.refresh();
      } else {
        setError(result.error ?? "Não foi possível registrar a decisão.");
      }
    });

  const add = (target: number | null, body: string) =>
    startTransition(async () => {
      const result = await onComment!(target, body);
      if (result.ok) router.refresh();
      else toast.error(result.error ?? "Não foi possível comentar.");
    });

  const { content } = review;
  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <div className="flex flex-col gap-4">
        <ReviewViewer files={review.files} fileBase={fileBase} onSlideChange={setSlide} />
        <Card>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <TypeBadge type={content.type} />
              <StatusBadge status={status} />
              <span className="text-xs text-muted-foreground">Versão {review.versionNumber}</span>
              {content.channel && <span className="text-xs text-muted-foreground">· {content.channel}</span>}
            </div>
            <h2 className="font-heading text-lg font-bold text-white">{content.title}</h2>
            {content.caption ? (
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">{content.caption}</p>
            ) : (
              <p className="text-sm text-muted-foreground">Sem legenda.</p>
            )}
            <dl className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <dt className="text-muted-foreground">Prazo de aprovação</dt>
                <dd className="font-medium text-white">{content.dueDate ? formatDate(content.dueDate) : "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Publicação prevista</dt>
                <dd className="font-medium text-white">{content.publishDate ? formatDate(content.publishDate) : "—"}</dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              Conteúdo exatamente como foi enviado para aprovação em {formatDateTime(review.frozenAt)}.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <CardContent className="flex flex-col gap-3">
            <h2 className="font-heading text-base font-bold text-white">Sua decisão</h2>
            {error && <Notice tone="error">{error}</Notice>}
            {canDecide ? (
              <DecisionPanel status="aguardando" version={review.versionNumber} onDecide={decide} />
            ) : (
              <div role="status" className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-muted-foreground">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{idleNotice}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            {onComment ? (
              <CommentsPanel
                comments={comments}
                totalSlides={review.files.length}
                authorName={approverName}
                authorRole="cliente"
                currentSlide={slide}
                onAdd={add}
              />
            ) : (
              <section aria-label="Comentários" className="flex flex-col gap-2">
                <h2 className="font-heading text-base font-bold text-white">Comentários</h2>
                {comments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum comentário.</p>
                ) : (
                  <ul className="flex flex-col gap-2 text-sm">
                    {comments.map((c) => (
                      <li key={c.id} className="rounded-xl border border-white/10 p-3">
                        <span className="font-semibold text-white">{c.author}</span>{" "}
                        <span className="text-xs text-muted-foreground">{formatDateTime(c.createdAt)}</span>
                        <p className="mt-1">{c.body}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 font-heading text-base font-bold text-white">
              <History className="size-4 text-primary" aria-hidden /> Histórico
            </h2>
            <ul className="flex flex-col gap-2 text-sm" data-testid="decision-history">
              {review.decisions.length === 0 && <li className="text-muted-foreground">Nenhuma decisão registrada ainda.</li>}
              {review.decisions.map((d) => (
                <li key={d.id} className="rounded-xl border border-white/10 p-3">
                  <p>
                    <span className="font-semibold text-white">{d.mine ? "Você" : "Outro aprovador"}</span>{" "}
                    {d.decision === "aprovado" ? "aprovou" : "pediu alteração"} · versão {d.versionNumber}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(d.at)} · {d.via === "link" ? "link rápido" : "portal"}
                  </p>
                  {d.note && <p className="mt-1 text-muted-foreground">{d.note}</p>}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Versões: {review.versions.map((v) => `v${v.number}${v.current ? " (em exibição)" : ""}`).join(" · ")}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
