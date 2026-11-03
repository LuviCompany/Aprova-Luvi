"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { removeFileAction, reorderFilesAction } from "@/app/admin/materiais/files-actions";
import { ConfirmActionDialog } from "@/components/approvers/confirm-action-dialog";
import { Notice } from "@/components/auth/auth-layout";
import { FilePreview } from "@/components/materials/file-preview";
import { Button } from "@/components/ui/button";
import { KIND_LABEL, formatBytes } from "@/lib/materials/files";
import type { VersionFile } from "@/lib/materials/versions";
import type { MaterialType } from "@/lib/types";

interface SlidesPanelProps {
  versionId: string;
  type: MaterialType;
  files: VersionFile[];
  /** Versão de trabalho (sem solicitação de aprovação): permite reordenar e remover. */
  editable: boolean;
}

/** Slides/arquivos da versão. Na versão de trabalho, reordena (botões acessíveis) e remove com confirmação. */
export function SlidesPanel({ versionId, type, files, editable }: SlidesPanelProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [order, setOrder] = useState<string[] | null>(null);

  const byId = new Map(files.map((f) => [f.id, f]));
  const shown = (order ?? files.map((f) => f.id)).map((id) => byId.get(id)).filter((f): f is VersionFile => !!f);
  const multi = type === "carrossel";

  const move = (index: number, delta: -1 | 1) => {
    const ids = shown.map((f) => f.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    const previous = order;
    setOrder(ids);
    setError(null);
    startTransition(async () => {
      const result = await reorderFilesAction(versionId, ids);
      if (result.error) {
        setOrder(previous);
        setError(result.error);
      } else {
        setOrder(null);
        router.refresh();
      }
    });
  };

  if (shown.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum arquivo nesta versão.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <Notice tone="error">{error}</Notice>}
      <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={multi ? "Slides do carrossel" : "Arquivo do material"}>
        {shown.map((file, index) => (
          <li key={file.id} className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <FilePreview file={file} className="aspect-square w-full" />
            <div className="min-w-0 text-sm">
              <p className="font-medium text-white">{multi ? `Slide ${index + 1}` : "Arquivo"}</p>
              <p className="truncate text-xs text-muted-foreground" title={file.originalName}>
                {file.originalName}
              </p>
              <p className="text-xs text-muted-foreground">
                {KIND_LABEL[file.kind]} · {formatBytes(file.sizeBytes)}
              </p>
            </div>
            {editable && (
              <div className="flex flex-wrap items-center gap-1">
                {multi && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      disabled={pending || index === 0}
                      onClick={() => move(index, -1)}
                      aria-label={`Mover o slide ${index + 1} para cima`}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      disabled={pending || index === shown.length - 1}
                      onClick={() => move(index, 1)}
                      aria-label={`Mover o slide ${index + 1} para baixo`}
                    >
                      <ArrowDown />
                    </Button>
                  </>
                )}
                <ConfirmActionDialog
                  triggerLabel="Remover"
                  triggerAriaLabel={multi ? `Remover o slide ${index + 1}` : "Remover o arquivo"}
                  triggerIcon={<Trash2 data-icon="inline-start" />}
                  title={multi ? `Remover o slide ${index + 1}?` : "Remover o arquivo?"}
                  description="O arquivo sai desta versão e é apagado do armazenamento. Só é possível enquanto a versão não foi enviada para aprovação."
                  confirmLabel="Remover"
                  destructive
                  onConfirm={async () => {
                    const result = await removeFileAction(file.id);
                    if (result.ok) router.refresh();
                    return result;
                  }}
                />
              </div>
            )}
          </li>
        ))}
      </ol>
      {pending && (
        <p role="status" className="text-xs text-muted-foreground">
          Salvando a nova ordem…
        </p>
      )}
    </div>
  );
}
