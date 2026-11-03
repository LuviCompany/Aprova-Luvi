import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChevronLeft, Archive } from "lucide-react";
import { z } from "zod";
import { ApproverCard } from "@/components/approvers/approver-card";
import { ApproverFormDialog } from "@/components/approvers/approver-form-dialog";
import { LinkApproverDialog } from "@/components/approvers/link-approver-dialog";
import { ArchiveClientButton } from "@/components/clients/archive-client-button";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { ProjectCard } from "@/components/clients/project-card";
import { ProjectFormDialog } from "@/components/clients/project-form-dialog";
import { PageHeader } from "@/components/page-header";
import { ListSkeleton } from "@/components/page-skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { demoClientDetail } from "@/lib/approvers/demo";
import { getClientDetail } from "@/lib/approvers/queries";
import { canManageClients } from "@/lib/auth/roles";
import { requireStaff } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/env";

export const metadata: Metadata = { title: "Cliente" };

export default function ClientDetailPage({ params }: PageProps<"/admin/clientes/[id]">) {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <ClientDetailContent params={params} />
    </Suspense>
  );
}

async function ClientDetailContent({ params }: { params: PageProps<"/admin/clientes/[id]">["params"] }) {
  // Papel e modo (demonstração/real) são decididos a cada requisição, no servidor.
  const user = await requireStaff();
  const { id } = await params;
  const demo = isDemoMode();
  // Cliente de outra organização e cliente inexistente têm a mesma resposta (a RLS não devolve a linha).
  if (!demo && !z.uuid().safeParse(id).success) notFound();
  const detail = demo ? demoClientDetail(id) : await getClientDetail(id);
  if (!detail) notFound();

  const { client, approvers, linkCandidates, projects } = detail;
  const canManage = !demo && canManageClients(user.role);
  const ordered = [...approvers].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "pt-BR"));

  return (
    <>
      <Link href="/admin/clientes" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-white">
        <ChevronLeft className="size-4" aria-hidden /> Clientes
      </Link>
      <PageHeader
        title={client.name}
        description={client.segment || "Segmento não informado"}
        actions={
          canManage ? (
            <>
              <ClientFormDialog
                mode="edit"
                client={{ id: client.id, name: client.name, segment: client.segment, initials: client.initials }}
              />
              <ArchiveClientButton id={client.id} name={client.name} active={client.active} />
            </>
          ) : undefined
        }
      />

      {!client.active && (
        <p
          role="note"
          className="mb-6 flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-muted-foreground"
        >
          <Archive className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Este cliente está <strong className="text-white">arquivado</strong>: ele não aparece no portal e não recebe
            projetos nem aprovadores novos. Reative-o para voltar a cadastrar.
          </span>
        </p>
      )}

      <section aria-labelledby="aprovadores" className="mb-10">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="aprovadores" className="flex items-center gap-3 font-heading text-xl font-bold text-white">
            <Avatar className="size-8">
              <AvatarFallback className="bg-primary/15 text-xs font-bold text-primary">{client.initials}</AvatarFallback>
            </Avatar>
            Aprovadores
          </h2>
          {canManage && client.active && (
            <div className="flex flex-wrap gap-2">
              <LinkApproverDialog clientId={client.id} candidates={linkCandidates} />
              <ApproverFormDialog mode="create" clientId={client.id} />
            </div>
          )}
        </div>
        {ordered.length === 0 ? (
          <p role="status" className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-muted-foreground">
            Nenhum aprovador cadastrado.
            {canManage && client.active ? " Use “Novo aprovador” para começar." : ""}
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {ordered.map((approver) => (
              <ApproverCard key={approver.id} approver={approver} canManage={canManage} clientActive={client.active} />
            ))}
          </div>
        )}
        {!demo && !canManage && (
          <p className="mt-4 text-xs text-muted-foreground">
            Seu perfil pode consultar os aprovadores. O cadastro é do Atendimento e da administração.
          </p>
        )}
      </section>

      <section aria-labelledby="projetos-do-cliente">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="projetos-do-cliente" className="font-heading text-xl font-bold text-white">
            Projetos
          </h2>
          {!demo && client.active && (
            <ProjectFormDialog mode="create" clients={[{ id: client.id, name: client.name }]} defaultClientId={client.id} />
          )}
        </div>
        {projects.length === 0 ? (
          <p role="status" className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-muted-foreground">
            Nenhum projeto cadastrado para este cliente.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} canEdit={!demo} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
