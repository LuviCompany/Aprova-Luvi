import { MESSAGES } from "@/lib/auth/errors";
import { DENIED, messageForDbError, type DbErrorLike } from "@/lib/clients/errors";

/**
 * Mensagens para as exceções escritas de propósito nas funções do fluxo de aprovação (migrations D1/D2).
 * Traduz pelo trecho do texto e nunca repassa o texto original do banco.
 */
const KNOWN: Array<[RegExp, string]> = [
  [/de 1 a 20 aprovadores/i, "Escolha de 1 a 20 aprovadores, sem repetir."],
  [/aprovador inválido|inativo|não autorizado/i, "Um dos aprovadores está inativo ou não pertence a este cliente."],
  [/só material em rascunho/i, "Este material não está em rascunho. Só rascunhos são enviados para aprovação."],
  [/prazo precisa estar no futuro/i, "O prazo precisa ser uma data futura."],
  [/conteúdo mudou desde o último envio/i, "O conteúdo mudou desde o último envio desta versão. Crie uma nova versão para reenviar."],
  [/versão mais recente/i, "Só a versão mais recente pode ser enviada para aprovação."],
  [/não possui arquivos/i, "A versão não tem arquivos. Envie ao menos um arquivo antes de pedir a aprovação."],
  [/já foi encerrada|já foi decidida/i, "Esta solicitação já foi respondida ou encerrada."],
  [/não está mais em aprovação/i, "Esta versão não está mais em aprovação. Atualize a página."],
  [/apenas solicitações abertas/i, "Só solicitações em aberto podem ser canceladas."],
  [/solicitação não está aberta/i, "A solicitação não está mais em aberto."],
  [/validade do link/i, "A validade do link deve ficar entre agora e 30 dias."],
  [/sem permissão para decidir/i, "Você não pode decidir esta solicitação."],
  [/violates check constraint.*decisions|relation "decisions"/i, "Descreva o que precisa mudar (mínimo de 10 caracteres)."],
];

export function messageForApprovalError(error: DbErrorLike | null | undefined): string {
  const text = error?.message ?? "";
  if (/fetch failed|network|timeout|ECONN|ENOTFOUND/i.test(text)) return MESSAGES.network;
  if (error?.code === "42501" || /row-level security|permission denied/i.test(text)) return DENIED;
  // "sem permissão" genérico antes da lista específica
  if (/^sem permissão.?$/i.test(text)) return DENIED;
  for (const [pattern, message] of KNOWN) if (pattern.test(text)) return message;
  return messageForDbError(error, "material");
}
