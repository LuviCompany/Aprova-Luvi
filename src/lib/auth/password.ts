export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 72; // limite do bcrypt usado pelo Supabase Auth

/**
 * Símbolos aceitos como "símbolo" pela política de senha do Supabase Auth
 * ("Lowercase, uppercase letters, digits and symbols"). O app usa o mesmo conjunto para recusar antes de ir
 * ao Auth; a regra do painel continua valendo para quem usar a API diretamente.
 */
export const PASSWORD_SYMBOLS = "!@#$%^&*()_+-=[]{};':\"\\|<>?,./`~";

/** Texto de ajuda mostrado nos formulários de criação e redefinição de senha. */
export const PASSWORD_RULE_HINT = `Mínimo de ${MIN_PASSWORD_LENGTH} caracteres, com letras maiúsculas e minúsculas, números e símbolos (como ! @ # $ %).`;

const COMMON = new Set([
  "1234567890",
  "12345678910",
  "0123456789",
  "password12",
  "senha12345",
  "senha123456",
  "qwertyuiop",
  "luvicompany",
  "aprovaluvi1",
  "password1234",
  "senha1234567",
  "luvicompany1",
  "aprovaluvi123",
]);

/** Devolve a primeira regra violada, ou null se a senha é aceitável. */
export function validateNewPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `A senha deve ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `A senha deve ter no máximo ${MAX_PASSWORD_LENGTH} caracteres.`;
  }
  if (!/[a-z]/.test(password)) return "Inclua ao menos uma letra minúscula.";
  if (!/[A-Z]/.test(password)) return "Inclua ao menos uma letra maiúscula.";
  if (!/\d/.test(password)) return "Inclua ao menos um número.";
  if (![...PASSWORD_SYMBOLS].some((symbol) => password.includes(symbol))) {
    return "Inclua ao menos um símbolo (como ! @ # $ %).";
  }
  if (new Set(password).size < 4) {
    return "A senha é muito repetitiva.";
  }
  if (COMMON.has(password.toLowerCase())) {
    return "Essa senha é muito comum. Escolha outra.";
  }
  return null;
}
