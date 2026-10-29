"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Link2, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CommentsPanel } from "@/components/comments-panel";
import { DecisionPanel } from "@/components/decision-panel";
import { MaterialViewer } from "@/components/material-viewer";
import { StatusBadge, TypeBadge } from "@/components/status-badge";
import { VersionHistory } from "@/components/version-history";
import { NOW } from "@/lib/mock/data";
import { formatDate } from "@/lib/format";
import type { Client, Comment, Decision, Material, MaterialStatus, Project } from "@/lib/types";

interface MaterialReviewProps {
  material: Material;
  client: Client;
  project: Project;
  initialComments: Comment[];
  initialDecisions: Decision[];
  /** "admin" é somente leitura para decisões; "portal" e "link" decidem como o aprovador. */
  mode: "admin" | "portal" | "link";
  actor: { name: string; role: Comment["authorRole"] };
  /** Esconde barra lateral de comentários/histórico (aprovação rápida enxuta). */
  compact?: boolean;
  onStatusChange?: (status: MaterialStatus) => void;
}

/**
 * Tela de revisão de um material. Na Fase 1 o estado vive só no navegador;
 * na Fase 2 cada ação vira uma Server Action autorizada no servidor + RLS.
 */
export function MaterialReview({
  material,
  client,
  project,
  initialComments,
  initialDecisions,
  mode,
  actor,
  compact = false,
  onStatusChange,
}: MaterialReviewProps) {
  const [status, setStatus] = useState<MaterialStatus>(material.status);
  const [comments, setComments] = useState(initialComments);
  const [decisions, setDecisions] = useState(initialDecisions);
  const [slide, setSlide] = useState(1);

  const version = material.versions[material.versions.length - 1].number;
  const totalSlides = material.type === "carrossel" || material.type === "pdf" ? material.slides : 1;

  const decide = (decision: "aprovado" | "alteracao", note?: string) => {
    const next: MaterialStatus = decision;
    setStatus(next);
    onStatusChange?.(next);
    setDecisions((prev) => [
      ...prev,
      {
        id: `local-${prev.length + 1}`,
        materialId: material.id,
        version,
        decision,
        by: actor.name,
        via: mode === "link" ? "link" : "portal",
        at: NOW,
        note,
      },
    ]);
    if (note) {
      setComments((prev) => [
        ...prev,
        {
          id: `local-c-${prev.length + 1}`,
          materialId: material.id,
          slide: null,
          author: actor.name,
          authorRole: actor.role,
          body: note,
          createdAt: NOW,
        },
      ]);
    }
    toast.success(decision === "aprovado" ? "Material aprovado. Obrigado!" : "Pedido de alteração enviado à Luvi.");
  };

  const addComment = (target: number | null, body: string) => {
    setComments((prev) => [
      ...prev,
      {
        id: `local-c-${prev.length + 1}`,
        materialId: material.id,
        slide: target,
        author: actor.name,
        authorRole: actor.role,
        body,
        createdAt: NOW,
      },
    ]);
    toast.success("Comentário adicionado.");
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <MaterialViewer material={material} slide={slide} onSlideChange={setSlide} />
        <Card>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={status} />
              <TypeBadge type={material.type} />
              <span className="text-xs text-muted-foreground">Versão {version}</span>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Cliente</dt>
                <dd className="text-white">{client.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Projeto</dt>
                <dd className="text-white">{project.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Canal</dt>
                <dd className="text-white">{material.channel}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Prazo</dt>
                <dd className="text-white">{formatDate(material.dueDate)}</dd>
              </div>
            </dl>
            {mode === "admin" ? (
              <div className="flex flex-wrap gap-2 border-t border-white/10 pt-3">
                <Button
                  variant="outline"
                  onClick={() => toast.success("Link seguro copiado (demonstração — válido por 7 dias).")}
                >
                  <Link2 data-icon="inline-start" /> Copiar link de aprovação
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => toast.success("Links ativos revogados (demonstração).")}
                >
                  <Ban data-icon="inline-start" /> Revogar links
                </Button>
              </div>
            ) : (
              <div className="border-t border-white/10 pt-3">
                <DecisionPanel status={status} version={version} onDecide={decide} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {!compact && (
        <div className="flex flex-col gap-6">
          <Card>
            <CardContent>
              <CommentsPanel
                comments={comments}
                totalSlides={totalSlides}
                authorName={actor.name}
                authorRole={actor.role}
                currentSlide={slide}
                onAdd={addComment}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <VersionHistory versions={material.versions} decisions={decisions} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
