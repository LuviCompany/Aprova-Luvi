import { z } from "zod";

export const MIN_CHANGE_NOTE = 10;
export const MAX_NOTE = 4000;
export const MAX_APPROVERS = 20;
export const MAX_MESSAGE = 500;

/**
 * POLÍTICA DE APROVAÇÃO FINAL (padrão do sistema, documentada em docs/MODULO-4.md):
 *  - o material só fica "aprovado" quando TODOS os aprovadores designados do envio aprovam;
 *  - se QUALQUER um pedir alteração, o material vai para ajustes e o restante do envio é cancelado;
 *  - todas as decisões individuais ficam preservadas.
 */
export const APPROVAL_POLICY_TEXT =
  "O material só é aprovado quando todos os aprovadores escolhidos aprovarem. Se qualquer um pedir alteração, o material volta para ajustes.";

const id = z.uuid();

/** Prazo escolhido no calendário (AAAA-MM-DD) vira o fim desse dia no horário de Brasília. */
export function dueDateToTimestamp(date: string): string {
  return `${date}T23:59:59-03:00`;
}

export const submitSchema = z.object({
  versionId: id,
  approverIds: z
    .array(id)
    .min(1, "Escolha ao menos um aprovador.")
    .max(MAX_APPROVERS, `No máximo ${MAX_APPROVERS} aprovadores.`)
    .refine((list) => new Set(list).size === list.length, "Não repita aprovadores."),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Prazo inválido.")
    .refine((value) => !Number.isNaN(Date.parse(`${value}T12:00:00Z`)), "Prazo inválido.")
    .nullable(),
  message: z.string().trim().max(MAX_MESSAGE, `Mensagem com no máximo ${MAX_MESSAGE} caracteres.`),
});
export type SubmitInput = z.infer<typeof submitSchema>;

const decisionShape = {
  decision: z.enum(["aprovado", "alteracao"]),
  note: z.string().trim().max(MAX_NOTE, `Texto com no máximo ${MAX_NOTE} caracteres.`),
};
const noteRule = (v: { decision: string; note: string }) => v.decision === "aprovado" || v.note.length >= MIN_CHANGE_NOTE;
const noteIssue = { message: `Descreva o que precisa mudar (mínimo de ${MIN_CHANGE_NOTE} caracteres).`, path: ["note"] };

/** Decisão sem o id da solicitação (o link rápido amarra a decisão ao link no banco). */
export const decisionInputSchema = z.object(decisionShape).refine(noteRule, noteIssue);
export const decisionSchema = z.object({ requestId: id, ...decisionShape }).refine(noteRule, noteIssue);

export const commentSchema = z.object({
  materialId: id,
  versionId: id,
  slide: z.number().int().min(1).max(10).nullable(),
  body: z.string().trim().min(1, "Escreva o comentário.").max(MAX_NOTE, `Comentário com no máximo ${MAX_NOTE} caracteres.`),
});
