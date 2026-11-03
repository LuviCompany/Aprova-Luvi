import { MESSAGES } from "@/lib/auth/errors";

export interface DbErrorLike {
  code?: string;
  message?: string;
}

export type Entity = "cliente" | "projeto" | "aprovador" | "vinculo" | "convite" | "material";

export const DENIED = "Você não tem permissão para esta ação.";

/**
 * Mensagens das exceções escritas de propósito nas funções e gatilhos do banco (P0001/23514):
 * traduz pelo trecho do texto, sem repassar o texto original.
 */
const KNOWN: Array<[RegExp, string]> = [
  [/cliente arquivado/i, "Este cliente está arquivado. Reative-o antes de cadastrar."],
  [/sem permiss/i, DENIED],
  [/mesmo do login/i, "O e-mail do aprovador precisa ser o mesmo do login vinculado."],
  [/origem inativo/i, "A pessoa de origem está inativa."],
  [/mesmo cliente/i, "Esta pessoa já pertence a este cliente."],
  [/aprovador inativo/i, "O aprovador está inativo."],
  [/já tem acesso ao portal/i, "Este aprovador já tem acesso ao portal."],
  [/não está em aberto/i, "Este convite não está mais em aberto."],
  [/já enviado para aprovação/i, "Este material já foi enviado para aprovação: o conteúdo só muda numa nova revisão."],
  [/fora de rascunho/i, "Este material já foi enviado para aprovação. Inicie uma revisão para trocar os arquivos."],
  [/versão já enviada/i, "Esta versão já foi enviada para aprovação: os arquivos não mudam."],
  [/só a versão mais recente/i, "Só a versão mais recente pode ser alterada."],
  [/todos os arquivos da versão/i, "A ordem dos slides está desatualizada. Recarregue a página."],
  [/motivo da revisão/i, "Informe o motivo da revisão (de 10 a 500 caracteres)."],
  [/aprovado ou com alteração/i, "Só material aprovado ou com alteração pedida entra em revisão."],
  [/incompatível com o tipo/i, "O arquivo não combina com o tipo do material."],
  [/fora da pasta do material/i, "Caminho de arquivo inválido."],
  [/operação de revisão/i, "Material aprovado: a nova versão só pode ser criada pela operação de revisão."],
];

const DUPLICATE: Record<Entity, string> = {
  cliente: "Já existe um cliente com esse nome.",
  projeto: "Esse registro já existe.",
  aprovador: "Este e-mail já está cadastrado neste cliente.",
  vinculo: "Esta pessoa já está vinculada a este cliente.",
  convite: "Já existe um convite em aberto para este aprovador.",
  material: "Esse material já existe.",
};

/**
 * Traduz um erro do PostgREST/Postgres numa mensagem para a tela, sem vazar nomes de tabela,
 * restrições nem texto interno do banco.
 */
export function messageForDbError(error: DbErrorLike | null | undefined, entity: Entity): string {
  const code = error?.code ?? "";
  const text = error?.message ?? "";
  if (/fetch failed|network|timeout|ECONN|ENOTFOUND/i.test(text)) return MESSAGES.network;
  if (code === "23505") return DUPLICATE[entity];
  if (code === "42501" || /row-level security|permission denied/i.test(text)) return DENIED;
  for (const [pattern, message] of KNOWN) if (pattern.test(text)) return message;
  if (code === "23514") return "Alguns dados não atendem às regras de cadastro. Confira os campos.";
  if (code === "23503") return "O registro relacionado não foi encontrado.";
  return "Não foi possível salvar. Tente novamente.";
}
