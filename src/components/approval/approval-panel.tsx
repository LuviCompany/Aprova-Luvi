"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, Clock, Copy, Link2, Loader2, MessageSquareWarning, Ban } from "lucide-react";
import { toast } from "sonner";
import { cancelSubmissionAction, createApprovalLinkAction, revokeApprovalLinkAction } from "@/app/admin/materiais/approval-actions";
import { Notice } from "@/components/auth/auth-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LinkState, StaffRequestItem, StaffSubmission, SubmissionSummary } from "@/lib/approval/staff-queries";
import { formatDate, formatDateTime } from "@/lib/format";

const SUMMARY_LABEL: Record<SubmissionSummary, string> = {
  em_andamento: "Em andamento",
  aprovada: "Aprovada por todos",
  alteracao: "Alteração solicitada",
  cancelada: "Cancelada",
};
const SUMMARY_STYLE: Record<SubmissionSummary, string> = {
  em_andamento: "border-warning/30 bg-warning/10 text-warning",
  aprovada: "border-success/30 bg-success/10 text-success",
  alteracao: "border-primary/40 bg-primary/10 text-primary",
  cancelada: "border-white/15 bg-white/5 text-muted-foreground",
};
const LINK_LABEL: Record<LinkState, string> = { ativo: "link ativo", expirado: "link expirado", revogado: "link revogado", usado: "link usado" };

function RequestRow({ request, onDone }: { request: StaffRequestItem; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [created, setCreated] = useState<{ url: string | null; emailSent: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = request.status === "aberta";

  const createLink = () =>
    startTransition(async () => {
      setError(null);
      const result = await createApprovalLinkAction(request.id, request.approverId);
      if (result.ok && result.link) {
        setCreated(result.link);
        onDone();
      } else setError(result.error ?? "Não foi possível criar o link.");
    });

  const revoke = () =>
    startTransition(async () => {
      setError(null);
      const result = await revokeApprovalLinkAction(request.link!.id);
      if (result.ok) {
        setCreated(null);
        onDone();
      } else setError(result.error ?? "Não foi possível revogar o link.");
    });

  const copy = async () => {
    if (!created?.url) return;
    try {
      await navigator.clipboard.writeText(created.url);
      toast.success("Link copiado.");
    } catch {
      toast.error("Não foi possível copiar. Selecione e copie o endereço manualmente.");
    }
  };

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-white/10 p-3 text-sm" data-testid="approval-request">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-white">{request.approverName}</span>
        <span className="text-xs text-muted-foreground">{request.approverEmail}</span>
        <span className="ml-auto inline-flex items-center gap-1 text-xs">
          {request.decision?.kind === "aprovado" && (
            <span className="inline-flex items-center gap-1 text-success">
              <CheckCircle2 className="size-3.5" aria-hidden /> Aprovou
            </span>
          )}
          {request.decision?.kind === "alteracao" && (
            <span className="inline-flex items-center gap-1 text-primary">
              <MessageSquareWarning className="size-3.5" aria-hidden /> Pediu alteração
            </span>
          )}
          {!request.decision && open && (
            <span className="inline-flex items-center gap-1 text-warning">
              <Clock className="size-3.5" aria-hidden /> Pendente
            </span>
          )}
          {!request.decision && !open && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Ban className="size-3.5" aria-hidden /> Cancelada
            </span>
          )}
        </span>
      </div>
      {request.decision && (
        <p className="text-xs text-muted-foreground">
          {formatDateTime(request.decision.at)} · {request.decision.via === "link" ? "link rápido" : "portal"}
          {request.decision.note ? ` · “${request.decision.note}”` : ""}
        </p>
      )}
      {open && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={createLink} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Link2 data-icon="inline-start" />}
            {request.link?.state === "ativo" ? "Gerar novo link" : "Gerar link rápido"}
          </Button>
          {request.link && (
            <span className="text-xs text-muted-foreground">
              {LINK_LABEL[request.link.state]}
              {request.link.state === "ativo" ? ` (até ${formatDate(request.link.expiresAt)})` : ""}
            </span>
          )}
          {request.link?.state === "ativo" && (
            <Button size="sm" variant="ghost" onClick={revoke} disabled={pending}>
              Revogar link
            </Button>
          )}
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {created && (
        <div role="status" className="flex flex-col gap-2 rounded-lg border border-success/30 bg-success/10 p-2.5 text-xs text-success">
          <p>
            Link criado. {created.emailSent ? "Enviamos por e-mail ao aprovador." : "O e-mail NÃO foi enviado (provedor não configurado ou falhou): copie e envie manualmente."}{" "}
            Este endereço aparece só agora.
          </p>
          {created.url && (
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-black/30 px-2 py-1 text-foreground">{created.url}</code>
              <Button size="sm" variant="outline" onClick={copy}>
                <Copy data-icon="inline-start" /> Copiar
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** Acompanhamento do ciclo de aprovação: cada envio, quem respondeu, quem está pendente, links e cancelamento. */
export function ApprovalPanel({ submissions }: { submissions: StaffSubmission[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const cancel = (requestId: string) =>
    startTransition(async () => {
      setError(null);
      const result = await cancelSubmissionAction(requestId);
      if (result.ok) router.refresh();
      else setError(result.error ?? "Não foi possível cancelar o envio.");
    });

  if (submissions.length === 0) {
    return <p className="text-sm text-muted-foreground">Este material ainda não foi enviado para aprovação.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Notice tone="error">{error}</Notice>}
      {submissions.map((submission) => {
        const firstOpen = submission.requests.find((r) => r.status === "aberta");
        const answered = submission.requests.filter((r) => r.decision).length;
        return (
          <section key={submission.id} aria-label={`Envio da versão ${submission.versionNumber}`} className="flex flex-col gap-3 rounded-2xl border border-white/10 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-heading text-sm font-bold text-white">Versão {submission.versionNumber}</h3>
              <Badge variant="outline" className={SUMMARY_STYLE[submission.summary]}>
                {SUMMARY_LABEL[submission.summary]}
              </Badge>
              <span className="text-xs text-muted-foreground">
                Enviado em {formatDateTime(submission.sentAt)}
                {submission.dueAt ? ` · prazo ${formatDate(submission.dueAt)}` : ""} · {answered} de {submission.requests.length} responderam
              </span>
              {firstOpen && (
                <Button size="sm" variant="outline" className="ml-auto" onClick={() => cancel(firstOpen.id)} disabled={pending}>
                  Cancelar envio
                </Button>
              )}
            </div>
            {submission.message && <p className="text-xs text-muted-foreground">Recado: {submission.message}</p>}
            <ul className="flex flex-col gap-2">
              {submission.requests.map((request) => (
                <RequestRow key={request.id} request={request} onDone={() => router.refresh()} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
