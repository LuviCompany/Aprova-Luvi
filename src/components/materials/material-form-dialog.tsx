"use client";

import { useId, useMemo, useState, useTransition, type FormEvent } from "react";
import { Loader2, Pencil, Plus } from "lucide-react";
import { saveMaterialAction, type MaterialFormState } from "@/app/admin/materiais/actions";
import { Notice } from "@/components/auth/auth-layout";
import { Field, describedBy } from "@/components/form-field";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TYPE_LABEL } from "@/lib/domain";
import {
  ASPECT_RATIOS,
  ASPECT_RATIO_LABEL,
  CHANNEL_SUGGESTIONS,
  LIMITS,
  MATERIAL_TYPES,
  charCount,
  isContentLocked,
  publishBeforeApproval,
  type AspectRatio,
} from "@/lib/materials/schema";
import type { MaterialStatus, MaterialType } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface EditableMaterial {
  id: string;
  clientName: string;
  projectName: string;
  status: MaterialStatus;
  type: MaterialType;
  title: string;
  description: string;
  caption: string;
  aspectRatio: AspectRatio | null;
  channel: string;
  publishDate: string | null;
  dueDate: string | null;
}

interface MaterialFormDialogProps {
  mode: "create" | "edit";
  /** Clientes ATIVOS (cadastro). */
  clients?: Array<{ id: string; name: string }>;
  /** Projetos não concluídos de qualquer cliente; a tela filtra pelo cliente escolhido. */
  projects?: Array<{ id: string; clientId: string; name: string }>;
  defaultClientId?: string;
  defaultProjectId?: string;
  material?: EditableMaterial;
}

export function MaterialFormDialog(props: MaterialFormDialogProps) {
  const { mode, material } = props;
  const [open, setOpen] = useState(false);
  return (
    <>
      {mode === "create" ? (
        <Button onClick={() => setOpen(true)}>
          <Plus data-icon="inline-start" /> Novo material
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} aria-label={`Editar ${material?.title ?? "material"}`}>
          <Pencil data-icon="inline-start" /> Editar
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        {/* Largo no desktop e rolável por dentro: legendas longas cabem sem empurrar a página. */}
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
          <MaterialForm {...props} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function MaterialForm({
  mode,
  clients = [],
  projects = [],
  defaultClientId,
  defaultProjectId,
  material,
  onDone,
}: MaterialFormDialogProps & { onDone: () => void }) {
  const id = useId();
  const [state, setState] = useState<MaterialFormState>({});
  const [pending, startTransition] = useTransition();

  // Campos controlados: um envio recusado NÃO apaga o que foi digitado (legendas longas dão trabalho).
  const [clientId, setClientId] = useState(material ? "" : (defaultClientId ?? ""));
  const [projectId, setProjectId] = useState(material ? "" : (defaultProjectId ?? ""));
  const [type, setType] = useState<MaterialType | "">(material?.type ?? "");
  const [title, setTitle] = useState(material?.title ?? "");
  const [aspectRatio, setAspectRatio] = useState<string>(material?.aspectRatio ?? "");
  const [channel, setChannel] = useState(material?.channel ?? "");
  const [caption, setCaption] = useState(material?.caption ?? "");
  const [description, setDescription] = useState(material?.description ?? "");
  const [publishDate, setPublishDate] = useState(material?.publishDate ?? "");
  const [dueDate, setDueDate] = useState(material?.dueDate ?? "");

  const errors = state.fieldErrors ?? {};
  const locked = material ? isContentLocked(material.status) : false;
  const clientProjects = useMemo(() => projects.filter((p) => p.clientId === clientId), [projects, clientId]);
  const captionCount = charCount(caption);
  const captionOver = captionCount > LIMITS.caption;
  const showDateWarning = publishBeforeApproval(publishDate || null, dueDate || null);
  const captionDescribedBy = [`${id}-caption-count`, errors.caption || captionOver ? `${id}-caption-error` : null].filter(Boolean).join(" ");
  const noClients = mode === "create" && clients.length === 0;
  const noProjects = mode === "create" && !!clientId && clientProjects.length === 0;

  const onClientChange = (value: string) => {
    setClientId(value);
    setProjectId("");
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData();
    if (material) data.set("id", material.id);
    data.set("clientId", clientId);
    data.set("projectId", projectId);
    data.set("type", type);
    data.set("title", title);
    data.set("description", description);
    data.set("caption", caption);
    data.set("aspectRatio", aspectRatio);
    data.set("channel", channel);
    data.set("publishDate", publishDate);
    data.set("dueDate", dueDate);
    startTransition(async () => {
      const result = await saveMaterialAction({}, data);
      if (result.ok) onDone();
      else setState(result);
    });
  };

  const typeHint = mode === "edit" ? "O tipo não pode ser alterado. Para trocá-lo, exclua o rascunho vazio e cadastre outro." : undefined;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{mode === "create" ? "Novo material" : "Editar material"}</DialogTitle>
        <DialogDescription>
          {mode === "create"
            ? "Cadastre os dados do material. Os arquivos entram numa etapa seguinte."
            : `${material?.clientName ?? "Cliente"} · ${material?.projectName ?? "Projeto"}. Cliente e projeto não podem ser trocados.`}
        </DialogDescription>
      </DialogHeader>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      {locked && (
        <Notice tone="info">
          Este material já foi enviado para aprovação: título, legenda, descrição, canal e proporção só mudam numa nova revisão.
          Você pode ajustar as datas.
        </Notice>
      )}

      {mode === "create" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${id}-client`} label="Cliente" error={errors.clientId} hint={noClients ? "Cadastre um cliente ativo antes de criar materiais." : undefined}>
            <NativeSelect
              id={`${id}-client`}
              required
              disabled={noClients}
              value={clientId}
              onChange={(e) => onClientChange(e.target.value)}
              aria-invalid={!!errors.clientId}
              aria-describedby={describedBy(`${id}-client`, noClients ? "x" : undefined, errors.clientId)}
            >
              <option value="" disabled>
                Escolha o cliente
              </option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            id={`${id}-project`}
            label="Projeto"
            error={errors.projectId}
            hint={noProjects ? "Este cliente não tem projeto em andamento. Cadastre um projeto antes." : undefined}
          >
            <NativeSelect
              id={`${id}-project`}
              required
              disabled={!clientId || noProjects}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              aria-invalid={!!errors.projectId}
              aria-describedby={describedBy(`${id}-project`, noProjects ? "x" : undefined, errors.projectId)}
            >
              <option value="" disabled>
                {clientId ? "Escolha o projeto" : "Escolha o cliente primeiro"}
              </option>
              {clientProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
      )}

      <Field id={`${id}-title`} label="Título" error={errors.title}>
        <Input
          id={`${id}-title`}
          required
          maxLength={LIMITS.title}
          autoComplete="off"
          disabled={locked}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={!!errors.title}
          aria-describedby={describedBy(`${id}-title`, undefined, errors.title)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field id={`${id}-type`} label="Tipo" error={errors.type} hint={typeHint}>
          {mode === "create" ? (
            <NativeSelect
              id={`${id}-type`}
              required
              value={type}
              onChange={(e) => setType(e.target.value as MaterialType)}
              aria-invalid={!!errors.type}
              aria-describedby={describedBy(`${id}-type`, undefined, errors.type)}
            >
              <option value="" disabled>
                Escolha o tipo
              </option>
              {MATERIAL_TYPES.map((value) => (
                <option key={value} value={value}>
                  {TYPE_LABEL[value]}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <Input id={`${id}-type`} value={type ? TYPE_LABEL[type] : ""} readOnly aria-describedby={describedBy(`${id}-type`, typeHint)} />
          )}
        </Field>
        <Field id={`${id}-ratio`} label="Proporção (opcional)" error={errors.aspectRatio}>
          <NativeSelect
            id={`${id}-ratio`}
            disabled={locked}
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value)}
            aria-invalid={!!errors.aspectRatio}
            aria-describedby={describedBy(`${id}-ratio`, undefined, errors.aspectRatio)}
          >
            <option value="">Não informada</option>
            {ASPECT_RATIOS.map((value) => (
              <option key={value} value={value}>
                {ASPECT_RATIO_LABEL[value]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id={`${id}-channel`} label="Canal (opcional)" error={errors.channel}>
          <Input
            id={`${id}-channel`}
            list={`${id}-channels`}
            maxLength={LIMITS.channel}
            autoComplete="off"
            placeholder="Ex.: Instagram Feed"
            disabled={locked}
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            aria-invalid={!!errors.channel}
            aria-describedby={describedBy(`${id}-channel`, undefined, errors.channel)}
          />
          <datalist id={`${id}-channels`}>
            {CHANNEL_SUGGESTIONS.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </Field>
      </div>

      <Field id={`${id}-caption`} label="Legenda (opcional)" error={errors.caption || (captionOver ? `A legenda pode ter no máximo ${LIMITS.caption} caracteres.` : undefined)}>
        <Textarea
          id={`${id}-caption`}
          rows={7}
          disabled={locked}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          className="max-h-[45dvh] min-h-40 resize-y"
          aria-invalid={!!errors.caption || captionOver}
          aria-describedby={captionDescribedBy}
        />
        <p
          id={`${id}-caption-count`}
          aria-live="polite"
          className={cn("text-right text-xs", captionOver ? "text-destructive" : "text-muted-foreground")}
        >
          {captionCount} / {LIMITS.caption} caracteres
        </p>
      </Field>

      <Field id={`${id}-description`} label="Descrição interna (opcional)" error={errors.description} hint="Notas para a equipe sobre o material.">
        <Textarea
          id={`${id}-description`}
          rows={3}
          disabled={locked}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-invalid={!!errors.description}
          aria-describedby={describedBy(`${id}-description`, "x", errors.description)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${id}-due`} label="Prazo de aprovação (opcional)" error={errors.dueDate}>
          <Input
            id={`${id}-due`}
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            aria-invalid={!!errors.dueDate}
            aria-describedby={describedBy(`${id}-due`, undefined, errors.dueDate)}
          />
        </Field>
        <Field id={`${id}-publish`} label="Publicação prevista (opcional)" error={errors.publishDate}>
          <Input
            id={`${id}-publish`}
            type="date"
            value={publishDate}
            onChange={(e) => setPublishDate(e.target.value)}
            aria-invalid={!!errors.publishDate}
            aria-describedby={describedBy(`${id}-publish`, undefined, errors.publishDate)}
          />
        </Field>
      </div>
      {showDateWarning && (
        <Notice tone="warning">A publicação está marcada antes do prazo de aprovação. Você ainda pode salvar.</Notice>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending || noClients || noProjects || captionOver}>
          {pending ? (
            <>
              <Loader2 className="animate-spin" data-icon="inline-start" /> Salvando…
            </>
          ) : mode === "create" ? (
            "Cadastrar material"
          ) : (
            "Salvar alterações"
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}
