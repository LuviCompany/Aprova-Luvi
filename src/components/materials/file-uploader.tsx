"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { CheckCircle2, Loader2, RotateCcw, UploadCloud, XCircle } from "lucide-react";
import { finalizeUploadsAction, prepareUploadsAction, type UploadedItem } from "@/app/admin/materiais/files-actions";
import { Notice } from "@/components/auth/auth-layout";
import { Button } from "@/components/ui/button";
import { acceptFor, formatBytes, isMultiSlide, validateUploadPlan } from "@/lib/materials/files";
import { sha256Hex, uploadToSignedUrl } from "@/lib/materials/upload-client";
import type { MaterialType } from "@/lib/types";

interface FileUploaderProps {
  materialId: string;
  type: MaterialType;
  /** Arquivos que a versão de trabalho já tem (conta para o limite de slides do carrossel). */
  existingCount: number;
}

type Phase = "queued" | "uploading" | "done" | "error";
interface Item {
  key: number;
  file: File;
  phase: Phase;
  progress: number;
  error?: string;
}

const PHASE_LABEL: Record<Phase, string> = { queued: "Na fila", uploading: "Enviando", done: "Enviado", error: "Falhou" };

/**
 * Envio de arquivos do material: valida na tela (e de novo no servidor), envia direto ao bucket privado com
 * progresso por arquivo, confere no servidor e permite tentar de novo só os que falharam.
 */
export function FileUploader({ materialId, type, existingCount }: FileUploaderProps) {
  const router = useRouter();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const counter = useRef(0);
  const [items, setItems] = useState<Item[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const multi = isMultiSlide(type);
  const patch = (key: number, changes: Partial<Item>) =>
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...changes } : item)));

  async function run(batch: Item[]) {
    setBusy(true);
    setMessage(null);
    batch.forEach((item) => patch(item.key, { phase: "queued", progress: 0, error: undefined }));

    const metas = batch.map((item) => ({ name: item.file.name, type: item.file.type, size: item.file.size }));
    const prepared = await prepareUploadsAction(materialId, metas);
    if (!prepared.ok) {
      batch.forEach((item, index) => patch(item.key, { phase: "error", error: prepared.perFile?.[index] ?? prepared.error }));
      setMessage(prepared.error);
      setBusy(false);
      return;
    }

    const uploaded: Array<{ item: Item; slot: (typeof prepared.uploads)[number] }> = [];
    // Dois envios por vez: aproveita a conexão sem disputar banda entre vídeos grandes.
    const queue = [...prepared.uploads];
    const worker = async () => {
      for (let slot = queue.shift(); slot; slot = queue.shift()) {
        const item = batch[slot.index];
        patch(item.key, { phase: "uploading", progress: 0 });
        try {
          await uploadToSignedUrl(slot.url, item.file, (fraction) => patch(item.key, { progress: fraction }));
          uploaded.push({ item, slot });
        } catch (error) {
          patch(item.key, { phase: "error", error: error instanceof Error ? error.message : "Falha no envio." });
        }
      }
    };
    await Promise.all([worker(), worker()]);

    if (uploaded.length === 0) {
      setMessage("Nenhum arquivo foi enviado.");
      setBusy(false);
      return;
    }

    // Mantém a ordem escolhida pelo usuário.
    uploaded.sort((a, b) => a.slot.index - b.slot.index);
    const payload: UploadedItem[] = await Promise.all(
      uploaded.map(async ({ item, slot }) => ({
        path: slot.path,
        name: item.file.name,
        type: item.file.type,
        size: item.file.size,
        checksum: await sha256Hex(item.file),
      })),
    );
    const finalized = await finalizeUploadsAction(materialId, payload);
    if (!finalized.ok) {
      uploaded.forEach(({ item }, i) => patch(item.key, { phase: "error", error: finalized.perFile?.[i] ?? finalized.error }));
      setMessage(finalized.error);
      setBusy(false);
      return;
    }
    uploaded.forEach(({ item }) => patch(item.key, { phase: "done", progress: 1 }));
    const failed = batch.length - uploaded.length;
    setMessage(
      failed > 0
        ? `${uploaded.length} de ${batch.length} arquivos enviados. Tente de novo os que falharam.`
        : `${uploaded.length === 1 ? "Arquivo enviado" : `${uploaded.length} arquivos enviados`} com sucesso.`,
    );
    setBusy(false);
    router.refresh();
    if (failed === 0) setTimeout(() => setItems([]), 2500);
  }

  function choose(list: FileList | null) {
    const files = list ? [...list] : [];
    if (input.current) input.current.value = "";
    if (files.length === 0) return;
    const plan = validateUploadPlan(type, existingCount, files.map((f) => ({ name: f.name, type: f.type, size: f.size })));
    const next: Item[] = files.map((file, index) => ({
      key: ++counter.current,
      file,
      phase: !plan.ok && plan.perFile[index] ? "error" : "queued",
      progress: 0,
      error: !plan.ok ? plan.perFile[index] : undefined,
    }));
    setItems(next);
    if (!plan.ok) {
      setMessage(plan.error);
      return;
    }
    void run(next);
  }

  const failedItems = items.filter((item) => item.phase === "error");
  const replacing = !multi && existingCount > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={input}
          id={inputId}
          type="file"
          multiple={multi}
          accept={acceptFor(type)}
          disabled={busy}
          onChange={(event) => choose(event.target.files)}
          className="sr-only"
        />
        <Button type="button" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <UploadCloud data-icon="inline-start" />}
          {busy ? "Enviando…" : replacing ? "Substituir arquivo" : multi ? "Adicionar slides" : "Enviar arquivo"}
        </Button>
        <label htmlFor={inputId} className="text-xs text-muted-foreground">
          {multi
            ? `Imagens (JPG, PNG, WebP até 20 MB) ou vídeos (MP4, MOV até 50 MB). Até 10 slides.`
            : type === "pdf"
              ? "PDF de até 50 MB."
              : type === "video"
                ? "Vídeo MP4 ou MOV de até 50 MB."
                : "Imagem JPG, PNG ou WebP de até 20 MB."}
        </label>
      </div>

      {message && <Notice tone={failedItems.length > 0 ? "error" : "info"}>{message}</Notice>}

      {items.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Arquivos em envio" aria-live="polite">
          {items.map((item) => (
            <li key={item.key} className="flex flex-col gap-1.5 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-white" title={item.file.name}>
                  {item.file.name} <span className="text-xs text-muted-foreground">({formatBytes(item.file.size)})</span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  {item.phase === "done" && <CheckCircle2 className="size-3.5 text-success" aria-hidden />}
                  {item.phase === "error" && <XCircle className="size-3.5 text-destructive" aria-hidden />}
                  {item.phase === "uploading" && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                  {PHASE_LABEL[item.phase]}
                  {item.phase === "uploading" && ` ${Math.round(item.progress * 100)}%`}
                </span>
              </div>
              {item.phase === "uploading" && (
                <progress value={item.progress} max={1} aria-label={`Progresso de ${item.file.name}`} className="h-1.5 w-full overflow-hidden rounded-full accent-primary" />
              )}
              {item.phase === "error" && item.error && <p className="text-xs text-destructive">{item.error}</p>}
            </li>
          ))}
        </ul>
      )}

      {failedItems.length > 0 && !busy && (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => void run(failedItems)}>
            <RotateCcw data-icon="inline-start" /> Tentar de novo ({failedItems.length})
          </Button>
        </div>
      )}
    </div>
  );
}
