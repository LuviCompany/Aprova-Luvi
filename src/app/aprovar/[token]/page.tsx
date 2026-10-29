import type { Metadata } from "next";
import { Ban, Clock, Lock, ShieldX } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { QuickApproval } from "@/components/quick-approval";
import { Card, CardContent } from "@/components/ui/card";
import { LINK_STATE_LABEL, clientById, maskEmail, projectById, resolveLinkState } from "@/lib/domain";
import { NOW, approvalLinks, clients, comments, decisions, materials, projects } from "@/lib/mock/data";
import type { LinkState } from "@/lib/types";

export const metadata: Metadata = {
  title: "Aprovação rápida",
  // Links de aprovação nunca devem ser indexados nem enviar o token em Referer.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const PROBLEM: Record<Exclude<LinkState, "valido">, { icon: typeof Clock; text: string }> = {
  expirado: {
    icon: Clock,
    text: "O prazo deste link terminou. Peça à equipe da Luvi um novo link de aprovação.",
  },
  revogado: {
    icon: Ban,
    text: "Este link foi cancelado pela equipe da Luvi. Peça um novo link, se precisar.",
  },
  utilizado: {
    icon: Lock,
    text: "Este material já foi avaliado por este link. Por segurança, cada link só pode ser usado uma vez.",
  },
};

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="luvi-glow flex min-h-screen flex-col overflow-hidden">
      <header className="flex h-16 items-center justify-center border-b border-white/10">
        <Logo size="sm" />
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>
      <footer className="py-6 text-center text-xs text-muted-foreground">Aprova Luvi · Luvi Company</footer>
    </div>
  );
}

export default async function QuickApprovalPage({ params }: PageProps<"/aprovar/[token]">) {
  const { token } = await params;
  const link = approvalLinks.find((l) => l.token === token);
  const state = resolveLinkState(link, NOW);
  const material = link && materials.find((m) => m.id === link.materialId);

  // Token desconhecido e link revogado respondem igual: não revela se o token já existiu.
  if (!link || !material) {
    return (
      <Frame>
        <Card className="mx-auto max-w-md">
          <CardContent className="flex flex-col items-center gap-3 py-6 text-center">
            <ShieldX className="size-10 text-destructive" aria-hidden />
            <h1 className="font-heading text-xl font-bold text-white">Link inválido</h1>
            <p className="text-sm text-muted-foreground">
              Não encontramos este link de aprovação. Confira o endereço ou fale com a equipe da Luvi.
            </p>
          </CardContent>
        </Card>
      </Frame>
    );
  }

  if (state !== "valido") {
    const { icon: Icon, text } = PROBLEM[state];
    return (
      <Frame>
        <Card className="mx-auto max-w-md">
          <CardContent className="flex flex-col items-center gap-3 py-6 text-center">
            <Icon className="size-10 text-warning" aria-hidden />
            <h1 className="font-heading text-xl font-bold text-white">{LINK_STATE_LABEL[state]}</h1>
            <p className="text-sm text-muted-foreground">{text}</p>
          </CardContent>
        </Card>
      </Frame>
    );
  }

  const client = clientById(material.clientId, clients)!;
  const project = projectById(material.projectId, projects)!;
  const approver = client.approvers.find((a) => a.id === link.approverId)!;

  return (
    <Frame>
      <QuickApproval
        material={material}
        client={client}
        project={project}
        approverName={approver.name}
        maskedEmail={maskEmail(approver.email)}
        comments={comments.filter((c) => c.materialId === material.id)}
        decisions={decisions.filter((d) => d.materialId === material.id)}
      />
    </Frame>
  );
}
