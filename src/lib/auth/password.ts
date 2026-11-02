export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 72; // limite do bcrypt usado pelo Supabase Auth

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
]);

/** Devolve a primeira regra violada, ou null se a senha é aceitável. */
export function validateNewPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `A senha deve ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `A senha deve ter no máximo ${MAX_PASSWORD_LENGTH} caracteres.`;
  }
  if (!/[a-zA-ZÀ-ÿ]/.test(password) || !/\d/.test(password)) {
    return "Use letras e números na senha.";
  }
  if (new Set(password).size < 4) {
    return "A senha é muito repetitiva.";
  }
  if (COMMON.has(password.toLowerCase())) {
    return "Essa senha é muito comum. Escolha outra.";
  }
  return null;
}
