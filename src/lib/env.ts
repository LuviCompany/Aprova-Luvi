/**
 * Leitura central das variáveis de ambiente (único lugar do app que lê process.env).
 *
 * Este arquivo não importa nada do projeto de propósito: o script `npm run env:check` o carrega
 * direto, sem build.
 *
 * Variáveis (nenhuma tem prefixo NEXT_PUBLIC_: o navegador nunca fala com o Supabase, tudo passa
 * por Server Actions e rotas do servidor, e assim nada é "congelado" na build):
 *
 *   SUPABASE_URL              URL do projeto
 *   SUPABASE_PUBLISHABLE_KEY  chave `sb_publishable_…` (legado aceito: SUPABASE_ANON_KEY)
 *   SUPABASE_SECRET_KEY       chave `sb_secret_…`, SÓ servidor (legado: SUPABASE_SERVICE_ROLE_KEY)
 *   APP_URL                   URL pública deste ambiente (legado: NEXT_PUBLIC_APP_URL)
 *   APROVA_DEMO_MODE          "true" liga a demonstração da Fase 1
 */

export type KeyKind =
  | "publishable"
  | "secret"
  | "legacy-anon"
  | "legacy-service-role"
  | "unknown";

/** Descobre que tipo de chave do Supabase é, sem nunca expor o valor. */
export function classifyKey(key: string | undefined | null): KeyKind {
  const value = key?.trim() ?? "";
  if (value.startsWith("sb_publishable_") && value.length > 20) return "publishable";
  if (value.startsWith("sb_secret_") && value.length > 20) return "secret";
  const parts = value.split(".");
  if (parts.length === 3 && parts[0].startsWith("eyJ")) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { role?: string };
      if (payload.role === "anon") return "legacy-anon";
      if (payload.role === "service_role") return "legacy-service-role";
    } catch {
      /* JWT malformado: cai em unknown */
    }
  }
  return "unknown";
}

const PUBLIC_KIND: readonly KeyKind[] = ["publishable", "legacy-anon"];
const SECRET_KIND: readonly KeyKind[] = ["secret", "legacy-service-role"];

const first = (...values: Array<string | undefined>): string | undefined =>
  values.map((v) => v?.trim()).find((v) => v);

const isLocalHost = (hostname: string) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";

export interface SupabaseConfig {
  url: string;
  /** Chave pública (publishable ou anon legada). Respeita a RLS. */
  publishableKey: string;
}

function readPublishableKey(env: NodeJS.ProcessEnv): string | undefined {
  return first(env.SUPABASE_PUBLISHABLE_KEY, env.SUPABASE_ANON_KEY);
}

function readSecretKey(env: NodeJS.ProcessEnv): string | undefined {
  return first(env.SUPABASE_SECRET_KEY, env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getSupabaseConfig(env: NodeJS.ProcessEnv = process.env): SupabaseConfig | null {
  const url = env.SUPABASE_URL?.trim();
  const publishableKey = readPublishableKey(env);
  if (!url || !publishableKey) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && !isLocalHost(parsed.hostname)) return null;
  } catch {
    return null;
  }
  // Uma chave secreta na variável pública entregaria o banco inteiro: recusa e não sobe.
  if (!PUBLIC_KIND.includes(classifyKey(publishableKey))) return null;
  return { url, publishableKey };
}

export function isSupabaseConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return getSupabaseConfig(env) !== null;
}

/**
 * Modo demonstração (Fase 1): login fictício e dados de exemplo. Exige opt-in explícito E a
 * ausência de configuração do Supabase. Configurar o Supabase desliga a demonstração
 * automaticamente, então o login fictício nunca convive com usuários reais.
 */
/** Produção de verdade (`next start`/Vercel): usado para marcar cookies como `Secure`. */
export function isProductionEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production";
}

export function isDemoMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.APROVA_DEMO_MODE === "true" && !isSupabaseConfigured(env);
}

/**
 * URL pública DESTE ambiente, usada nos links de e-mail (recuperação de senha, convites).
 *  - Desenvolvimento (NODE_ENV != production): só aceita localhost; qualquer outro valor é
 *    ignorado, para que um .env.local copiado da produção nunca gere link para a produção.
 *  - Produção: exige https (ou localhost, para testes locais com `next start`); sem valor válido
 *    devolve null e quem chamou deve falhar, em vez de mandar link errado.
 */
export function getSiteUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = first(env.APP_URL, env.NEXT_PUBLIC_APP_URL);
  const production = env.NODE_ENV === "production";
  let origin: URL | null = null;
  if (raw) {
    try {
      origin = new URL(raw);
    } catch {
      origin = null;
    }
  }
  const usable =
    origin &&
    (origin.protocol === "https:" || (origin.protocol === "http:" && isLocalHost(origin.hostname))) &&
    (production || isLocalHost(origin.hostname));
  if (usable && origin) return origin.origin;
  return production ? null : "http://localhost:3000";
}

export class MissingEnvError extends Error {
  constructor(name: string) {
    super(`Variável de ambiente ausente ou inválida: ${name}`);
    this.name = "MissingEnvError";
  }
}

/** Chave secreta (ignora a RLS): somente servidor. Falha alto se faltar ou for do tipo errado. */
export function requireSecretKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = readSecretKey(env);
  if (!key || !SECRET_KIND.includes(classifyKey(key))) throw new MissingEnvError("SUPABASE_SECRET_KEY");
  return key;
}

/**
 * Segredo (pepper) do fluxo de aprovação por link: entra no HMAC dos códigos de verificação e dos
 * identificadores de sessão, para que um vazamento só do banco não permita descobrir um código
 * de 6 dígitos por força bruta. Mínimo de 32 caracteres; SÓ servidor.
 */
export function requireLinkSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.APPROVAL_LINK_SECRET?.trim();
  if (!secret || secret.length < 32) throw new MissingEnvError("APPROVAL_LINK_SECRET");
  return secret;
}

export type EmailProviderConfig =
  | { kind: "simulated" }
  | { kind: "resend"; apiKey: string; from: string }
  | { kind: "none"; reason: string };

/**
 * Provedor de e-mail. `simulated` (guarda a mensagem só em memória, para desenvolvimento e testes) é
 * RECUSADO em produção. `resend` exige RESEND_API_KEY e EMAIL_FROM. Sem nada configurado: "none" —
 * quem envia deve falhar de forma clara, nunca fingir que enviou.
 */
export function getEmailProviderConfig(env: NodeJS.ProcessEnv = process.env): EmailProviderConfig {
  const kind = env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (kind === "simulated") {
    return isProductionEnv(env)
      ? { kind: "none", reason: "O provedor simulado de e-mail não é permitido em produção." }
      : { kind: "simulated" };
  }
  if (kind === "resend") {
    const apiKey = env.RESEND_API_KEY?.trim();
    const from = env.EMAIL_FROM?.trim();
    if (!apiKey || !from) return { kind: "none", reason: "RESEND_API_KEY e EMAIL_FROM são obrigatórios para o provedor resend." };
    return { kind: "resend", apiKey, from };
  }
  return { kind: "none", reason: "Nenhum provedor de e-mail configurado (EMAIL_PROVIDER)." };
}

export interface EnvDiagnosis {
  ok: boolean;
  /** Problemas que impedem o uso seguro. */
  errors: string[];
  /** Pontos de atenção (ex.: usar chaves legadas). */
  warnings: string[];
  /** Resumo seguro (sem valores de chaves). */
  summary: Record<string, string>;
}

/** Diagnóstico para `npm run env:check`. Nunca devolve o valor de uma chave. */
export function diagnoseEnv(env: NodeJS.ProcessEnv = process.env): EnvDiagnosis {
  const errors: string[] = [];
  const warnings: string[] = [];
  const url = env.SUPABASE_URL?.trim();
  const pub = readPublishableKey(env);
  const sec = readSecretKey(env);

  let host = "(ausente)";
  if (!url) errors.push("SUPABASE_URL ausente.");
  else {
    try {
      const parsed = new URL(url);
      host = parsed.host;
      if (parsed.protocol !== "https:" && !isLocalHost(parsed.hostname)) errors.push("SUPABASE_URL deve usar https.");
    } catch {
      errors.push("SUPABASE_URL não é uma URL válida.");
    }
  }

  const pubKind = classifyKey(pub);
  if (!pub) errors.push("SUPABASE_PUBLISHABLE_KEY ausente.");
  else if (!PUBLIC_KIND.includes(pubKind)) {
    errors.push(
      SECRET_KIND.includes(pubKind)
        ? "SUPABASE_PUBLISHABLE_KEY contém uma chave SECRETA. Troque pela `sb_publishable_…` e rotacione a secreta."
        : "SUPABASE_PUBLISHABLE_KEY não parece uma chave do Supabase (esperado `sb_publishable_…`).",
    );
  } else if (pubKind === "legacy-anon") warnings.push("Usando a chave legada `anon`. Prefira `sb_publishable_…`.");
  if (!env.SUPABASE_PUBLISHABLE_KEY && env.SUPABASE_ANON_KEY) warnings.push("SUPABASE_ANON_KEY é legada: use SUPABASE_PUBLISHABLE_KEY.");

  const secKind = classifyKey(sec);
  if (sec && !SECRET_KIND.includes(secKind)) {
    errors.push(
      PUBLIC_KIND.includes(secKind)
        ? "SUPABASE_SECRET_KEY contém uma chave PÚBLICA. Use a `sb_secret_…`."
        : "SUPABASE_SECRET_KEY não parece uma chave do Supabase (esperado `sb_secret_…`).",
    );
  } else if (secKind === "legacy-service-role") warnings.push("Usando a chave legada `service_role`. Prefira `sb_secret_…`.");
  if (!env.SUPABASE_SECRET_KEY && env.SUPABASE_SERVICE_ROLE_KEY) warnings.push("SUPABASE_SERVICE_ROLE_KEY é legada: use SUPABASE_SECRET_KEY.");
  if (!sec) warnings.push("SUPABASE_SECRET_KEY ausente: login e telas funcionam, mas convites, links e URLs assinadas não.");

  if ((env.APPROVAL_LINK_SECRET?.trim().length ?? 0) < 32) {
    warnings.push("APPROVAL_LINK_SECRET ausente ou curta (mínimo 32 caracteres): a aprovação por link não funciona sem ela.");
  }
  const emailConfig = getEmailProviderConfig(env);
  if (emailConfig.kind === "none") warnings.push(`E-mail: ${emailConfig.reason} Links e códigos não serão enviados.`);

  const site = getSiteUrl(env);
  if (!site) errors.push("APP_URL ausente ou inválida em produção (precisa ser https).");
  if (env.NODE_ENV !== "production" && first(env.APP_URL, env.NEXT_PUBLIC_APP_URL) && site === "http://localhost:3000") {
    const raw = first(env.APP_URL, env.NEXT_PUBLIC_APP_URL) ?? "";
    if (!raw.startsWith("http://localhost")) {
      warnings.push("APP_URL aponta para fora de localhost em desenvolvimento: foi ignorada (links usarão http://localhost:3000).");
    }
  }
  if (env.APROVA_DEMO_MODE === "true" && getSupabaseConfig(env)) {
    warnings.push("APROVA_DEMO_MODE=true será ignorado porque o Supabase está configurado.");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      supabaseHost: host,
      publishableKey: pub ? pubKind : "ausente",
      secretKey: sec ? secKind : "ausente",
      siteUrl: site ?? "(inválida)",
      emailProvider: emailConfig.kind,
      linkSecret: (env.APPROVAL_LINK_SECRET?.trim().length ?? 0) >= 32 ? "definido" : "ausente",
      demoMode: String(isDemoMode(env)),
    },
  };
}
