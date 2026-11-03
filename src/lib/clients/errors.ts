import { MESSAGES } from "@/lib/auth/errors";

export interface DbErrorLike {
  code?: string;
  message?: string;
}

export type Entity = "cliente" | "projeto";

/**
 * Traduz um erro do PostgREST/Postgres numa mensagem para a tela, sem vazar nomes de tabela,
 * restrições nem texto interno do banco.
 */
export function messageForDbError(error: DbErrorLike | null | undefined, entity: Entity): string {
  const code = error?.code ?? "";
  const text = error?.message ?? "";
  if (/fetch failed|network|timeout|ECONN|ENOTFOUND/i.test(text)) return MESSAGES.network;
  if (code === "23505") return entity === "cliente" ? "Já existe um cliente com esse nome." : "Esse registro já existe.";
  if (code === "42501" || /row-level security|permission denied/i.test(text)) {
    return "Você não tem permissão para esta ação.";
  }
  if (code === "23514") return "Alguns dados não atendem às regras de cadastro. Confira os campos.";
  if (code === "23503") return "O registro relacionado não foi encontrado.";
  return "Não foi possível salvar. Tente novamente.";
}
