import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { LinkFrame, LinkProblemCard } from "@/components/approval/link-frame";
import { LinkVerifyCard } from "@/components/approval/link-verify-card";
import { ReviewScreen } from "@/components/approval/review-screen";
import { QuickApproval } from "@/components/quick-approval";
import { PageSkeleton } from "@/components/page-skeleton";
import { clientById, maskEmail, projectById, resolveLinkState } from "@/lib/domain";
import { isDemoMode, isSupabaseConfigured } from "@/lib/env";
import { readSessionId } from "@/lib/link-approval/cookie";
import { getLinkContext, loadLinkReview, resolveLink } from "@/lib/link-approval/service";
import { NOW, approvalLinks, clients, comments, decisions, materials, projects } from "@/lib/mock/data";
import { linkDecideAction, requestCodeAction, verifyCodeAction } from "./actions";

export const metadata: Metadata = {
  title: "Aprovação rápida",
  // Links de aprovação nunca devem ser indexados nem enviar o token em Referer.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function QuickApprovalPage({ params }: PageProps<"/aprovar/[token]">) {
  return (
    <Suspense
      fallback={
        <LinkFrame>
          <PageSkeleton />
        </LinkFrame>
      }
    >
      <QuickApprovalContent params={params} />
    </Suspense>
  );
}

async function QuickApprovalContent({ params }: { params: PageProps<"/aprovar/[token]">["params"] }) {
  await connection();
  const { token } = await params;

  if (isDemoMode()) return <DemoView token={token} />;
  if (!isSupabaseConfigured() || !process.env.APPROVAL_LINK_SECRET) {
    return (
      <LinkFrame>
        <LinkProblemCard kind="unavailable" />
      </LinkFrame>
    );
  }

  let state;
  try {
    const result = await getLinkContext(token, await readSessionId(token));
    if (result.status === "no_session") {
      const resolved = await resolveLink(token);
      state = resolved.status === "ok" ? ({ kind: "verify", ...resolved } as const) : ({ kind: "problem", problem: resolved.status } as const);
    } else if (result.status === "ok") {
      state = { kind: "review", context: result.context, data: await loadLinkReview(result.context) } as const;
    } else {
      state = { kind: "problem", problem: result.status } as const;
    }
  } catch {
    return (
      <LinkFrame>
        <LinkProblemCard kind="unavailable" />
      </LinkFrame>
    );
  }

  if (state.kind === "problem") {
    return (
      <LinkFrame>
        <LinkProblemCard kind={state.problem} />
      </LinkFrame>
    );
  }

  if (state.kind === "verify") {
    return (
      <LinkFrame>
        <LinkVerifyCard
          clientName={state.clientName}
          emailHint={state.emailHint}
          onRequestCode={requestCodeAction.bind(null, token)}
          onVerify={verifyCodeAction.bind(null, token)}
        />
      </LinkFrame>
    );
  }

  const { context, data } = state;
  return (
    <LinkFrame>
      <ReviewScreen
        review={data.review}
        status={data.status}
        fileBase={`/aprovar/${token}/arquivos`}
        canDecide
        idleNotice=""
        approverName={context.approverName}
        onDecide={linkDecideAction.bind(null, token)}
      />
    </LinkFrame>
  );
}

/** Demonstração (Fase 1): tokens fictícios e dados de exemplo. Fora dela nenhum deles vale. */
function DemoView({ token }: { token: string }) {
  const link = approvalLinks.find((l) => l.token === token);
  const state = resolveLinkState(link, NOW);
  const material = link && materials.find((m) => m.id === link.materialId);

  if (!link || !material) {
    return (
      <LinkFrame>
        <LinkProblemCard kind="invalid" />
      </LinkFrame>
    );
  }
  if (state !== "valido") {
    const kind = state === "expirado" ? "expired" : state === "revogado" ? "revoked" : "used";
    return (
      <LinkFrame>
        <LinkProblemCard kind={kind} />
      </LinkFrame>
    );
  }

  const client = clientById(material.clientId, clients)!;
  const project = projectById(material.projectId, projects)!;
  const approver = client.approvers.find((a) => a.id === link.approverId)!;
  return (
    <LinkFrame>
      <QuickApproval
        material={material}
        client={client}
        project={project}
        approverName={approver.name}
        maskedEmail={maskEmail(approver.email)}
        comments={comments.filter((c) => c.materialId === material.id)}
        decisions={decisions.filter((d) => d.materialId === material.id)}
      />
    </LinkFrame>
  );
}
