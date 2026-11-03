"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteMaterialAction } from "@/app/admin/materiais/actions";
import { ConfirmActionDialog } from "@/components/approvers/confirm-action-dialog";

interface DeleteMaterialButtonProps {
  materialId: string;
  title: string;
  /** Rota para onde voltar depois de excluir (a página do material deixa de existir). */
  redirectTo?: string;
}

/** Exclusão de rascunho vazio, com confirmação. O servidor e o banco recusam qualquer outro caso. */
export function DeleteMaterialButton({ materialId, title, redirectTo }: DeleteMaterialButtonProps) {
  const router = useRouter();
  return (
    <ConfirmActionDialog
      triggerLabel="Excluir"
      triggerAriaLabel={`Excluir ${title}`}
      triggerIcon={<Trash2 data-icon="inline-start" />}
      title={`Excluir “${title}”?`}
      description="Só rascunhos sem versões podem ser excluídos. A exclusão não pode ser desfeita e fica registrada na auditoria (sem o conteúdo do material)."
      confirmLabel="Excluir rascunho"
      destructive
      onConfirm={async () => {
        const result = await deleteMaterialAction(materialId);
        if (result.ok && redirectTo) router.push(redirectTo);
        return result;
      }}
    />
  );
}
