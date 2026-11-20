import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Harness de testes de banco: sobe um Postgres em memória (PGlite), imita o que o Supabase
 * fornece (roles, schemas auth/storage, auth.uid(), privilégios padrão) e aplica as migrations
 * reais de supabase/migrations. Assim RLS, grants e triggers são testados de verdade, sem
 * credenciais e sem tocar em nenhum projeto Supabase.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

// Reproduz o ambiente do Supabase ANTES das migrations (inclusive os GRANTs automáticos
// em tabelas novas, que as migrations precisam revogar).
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (id uuid primary key, email text unique);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  create schema storage;
  create table storage.buckets (
    id text primary key, name text not null, public boolean not null default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text not null,
    owner uuid,
    unique (bucket_id, name)
  );
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated, service_role;
  grant all on all tables in schema storage to anon, authenticated, service_role;

  grant usage on schema public to anon, authenticated, service_role;
`;

// Privilégios automáticos dos projetos ANTIGOS do Supabase (o desenvolvimento). Os projetos criados depois de
// 30/05/2026 não os têm: tabelas novas nascem sem nenhum privilégio para os papéis da API.
const LEGACY_DEFAULT_PRIVILEGES = `
  -- O Supabase concede aos papéis da API tanto por schema quanto GLOBALMENTE (para postgres e
  -- supabase_admin; o pré-voo no projeto real mostrou esses padrões). Os dois são reproduzidos
  -- aqui: uma migration que só revogue "IN SCHEMA public" deixaria o padrão global ativo.
  alter default privileges grant all on tables to anon, authenticated, service_role;
  alter default privileges grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

// Padrão dos projetos NOVOS, medido no projeto de produção em 2026-11-20: tabelas novas nascem SEM SELECT/INSERT/UPDATE/DELETE para
// os papéis da API, mas o service_role ficou com TRUNCATE, REFERENCES e TRIGGER (17 tabelas x 3 = 51 privilégios além do necessário).
const NEW_DEFAULT_PRIVILEGES = `
  alter default privileges grant truncate, references, trigger on tables to service_role;
  alter default privileges in schema public grant truncate, references, trigger on tables to service_role;
`;

export type SupabaseDefaults = "legacy" | "2026";

export type TestDb = PGlite & {
  asUser<T>(userId: string, fn: () => Promise<T>): Promise<T>;
  asService<T>(fn: () => Promise<T>): Promise<T>;
  asAnon<T>(fn: () => Promise<T>): Promise<T>;
};

export async function createTestDb(
  options: {
    migrate?: boolean;
    /** "legacy" (padrão): privilégios automáticos do projeto de desenvolvimento. "2026": como o projeto de produção. */
    supabaseDefaults?: SupabaseDefaults;
    /** Aplica só as migrations anteriores a este prefixo de arquivo (ex.: "20261120120000"). */
    stopBefore?: string;
    /**
     * Depois das migrations, devolve ALL ao service_role. Só para testes que provam que as TRAVAS (gatilhos, imutabilidade)
     * valem até para um servidor com todos os privilégios; o privilégio mínimo real (migration 16) é testado em
     * service-role-grants.test.ts e privileges.test.ts.
     */
    serviceRoleFullAccess?: boolean;
  } = {},
): Promise<TestDb> {
  const db = new PGlite() as TestDb;
  await db.exec(SUPABASE_STUB);
  await db.exec((options.supabaseDefaults ?? "legacy") === "legacy" ? LEGACY_DEFAULT_PRIVILEGES : NEW_DEFAULT_PRIVILEGES);

  const files = options.migrate === false
    ? []
    : readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql") && (!options.stopBefore || f < options.stopBefore))
        .sort();
  for (const file of files) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    } catch (error) {
      throw new Error(`Falha ao aplicar ${file}: ${(error as Error).message}`);
    }
  }

  if (options.serviceRoleFullAccess) await db.exec("grant all on all tables in schema public to service_role");

  const withRole = async <T>(role: string, sub: string | null, fn: () => Promise<T>): Promise<T> => {
    await db.exec(`select set_config('request.jwt.claim.sub', '${sub ?? ""}', false)`);
    await db.exec(`set role ${role}`);
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
      await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
    }
  };

  db.asUser = (userId, fn) => withRole("authenticated", userId, fn);
  db.asService = (fn) => withRole("service_role", null, fn);
  db.asAnon = (fn) => withRole("anon", null, fn);
  return db;
}

/** UUID determinístico legível nos testes: uid(1) => 00000000-0000-4000-8000-000000000001. */
export function uid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export const IDS = {
  orgLuvi: uid(1),
  orgOutra: uid(2),
  // usuários (auth.users / profiles)
  admin: uid(10),
  designer: uid(11),
  atendimento: uid(12),
  staffOutraOrg: uid(13),
  userClienteA: uid(20),
  userClienteB: uid(21),
  userInativo: uid(22),
  // clientes
  clienteA: uid(30),
  clienteB: uid(31),
  clienteOutraOrg: uid(32),
  // aprovadores
  aprovadorA: uid(40),
  aprovadorALink: uid(41), // sem login, só por link
  aprovadorB: uid(42),
  aprovadorInativo: uid(43),
  // projetos
  projetoA: uid(50),
  projetoB: uid(51),
} as const;

/** Dados-base FICTÍCIOS. Nenhum cliente real. Roda como superusuário (ignora RLS). */
export async function seedBase(db: TestDb): Promise<void> {
  const users: Array<[string, string, string, string, string]> = [
    [IDS.admin, "admin@luvi.test", IDS.orgLuvi, "Admin Teste", "admin"],
    [IDS.designer, "designer@luvi.test", IDS.orgLuvi, "Designer Teste", "designer"],
    [IDS.atendimento, "atendimento@luvi.test", IDS.orgLuvi, "Atendimento Teste", "atendimento"],
    [IDS.staffOutraOrg, "staff@outra.test", IDS.orgOutra, "Staff Outra Agência", "admin"],
    [IDS.userClienteA, "a@clientea.test", IDS.orgLuvi, "Aprovador A", "cliente"],
    [IDS.userClienteB, "b@clienteb.test", IDS.orgLuvi, "Aprovador B", "cliente"],
    [IDS.userInativo, "inativo@clientea.test", IDS.orgLuvi, "Aprovador Inativo", "cliente"],
  ];

  await db.exec(`
    insert into public.organizations (id, name, slug) values
      ('${IDS.orgLuvi}', 'Agência Teste', 'agencia-teste'),
      ('${IDS.orgOutra}', 'Outra Agência', 'outra-agencia');
  `);
  for (const [id, email] of users) {
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
  }
  for (const [id, email, org, name, role] of users) {
    await db.query(
      "insert into public.profiles (id, organization_id, full_name, email, role, active) values ($1,$2,$3,$4,$5,$6)",
      [id, org, name, email, role, id !== IDS.userInativo],
    );
  }

  await db.exec(`
    insert into public.clients (id, organization_id, name, segment, initials) values
      ('${IDS.clienteA}', '${IDS.orgLuvi}', 'Cliente A Teste', 'Varejo', 'CA'),
      ('${IDS.clienteB}', '${IDS.orgLuvi}', 'Cliente B Teste', 'Saúde', 'CB'),
      ('${IDS.clienteOutraOrg}', '${IDS.orgOutra}', 'Cliente de Outra Agência', 'Moda', 'CO');

    insert into public.approvers (id, client_id, profile_id, name, email, active) values
      ('${IDS.aprovadorA}', '${IDS.clienteA}', '${IDS.userClienteA}', 'Aprovador A', 'a@clientea.test', true),
      ('${IDS.aprovadorALink}', '${IDS.clienteA}', null, 'Aprovador A (só link)', 'link@clientea.test', true),
      ('${IDS.aprovadorB}', '${IDS.clienteB}', '${IDS.userClienteB}', 'Aprovador B', 'b@clienteb.test', true),
      ('${IDS.aprovadorInativo}', '${IDS.clienteA}', '${IDS.userInativo}', 'Aprovador Inativo', 'inativo@clientea.test', true);

    insert into public.projects (id, client_id, name) values
      ('${IDS.projetoA}', '${IDS.clienteA}', 'Projeto A'),
      ('${IDS.projetoB}', '${IDS.clienteB}', 'Projeto B');
  `);
}

export interface SentMaterial {
  materialId: string;
  versionId: string;
  requestId: string;
  filePath: string;
}

let counter = 1000;
const next = () => uid(++counter);

/** Cria material + versão + arquivo (e, opcionalmente, a solicitação aberta). Como superusuário. */
export async function createMaterial(
  db: TestDb,
  opts: { clientId: string; projectId: string; sent?: boolean; title?: string; approverId?: string },
): Promise<SentMaterial> {
  const materialId = next();
  const versionId = next();
  const fileId = next();
  const requestId = next();
  const filePath = `${opts.clientId}/${materialId}/${versionId}/${fileId}.png`;

  await db.query(
    "insert into public.materials (id, project_id, client_id, title, type, created_by) values ($1,$2,$3,$4,'imagem',$5)",
    [materialId, opts.projectId, opts.clientId, opts.title ?? "Material de teste", IDS.designer],
  );
  await db.query(
    "insert into public.material_versions (id, material_id, client_id, note, created_by) values ($1,$2,$3,'v1',$4)",
    [versionId, materialId, opts.clientId, IDS.designer],
  );
  await db.query(
    `insert into public.material_files (id, version_id, material_id, client_id, slide_position, kind,
       storage_path, original_name, mime_type, size_bytes, created_by)
     values ($1,$2,$3,$4,1,'imagem',$5,'arte.png','image/png',1000,$6)`,
    [fileId, versionId, materialId, opts.clientId, filePath, IDS.designer],
  );
  await db.query(
    "insert into storage.objects (bucket_id, name) values ('materials', $1)",
    [filePath],
  );
  if (opts.sent) {
    await insertRequest(db, {
      id: requestId, materialId, versionId, clientId: opts.clientId, approverId: opts.approverId,
    });
  }
  return { materialId, versionId, requestId, filePath };
}

/** Aprovador padrão (com login) de cada cliente de teste. */
export const defaultApprover = (clientId: string): string =>
  clientId === IDS.clienteB ? IDS.aprovadorB : IDS.aprovadorA;

/**
 * Cria UMA solicitação individual como superusuário (o app não tem mais INSERT direto: usa
 * public.submit_for_approval). Sem submissionId, abre uma rodada nova.
 */
export async function insertRequest(
  db: TestDb,
  r: {
    id?: string; materialId: string; versionId: string; clientId: string;
    approverId?: string; submissionId?: string; requestedBy?: string;
  },
): Promise<string> {
  const id = r.id ?? next();
  await db.query(
    `insert into public.approval_requests
       (id, material_id, version_id, client_id, requested_by, approver_id, submission_id)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [id, r.materialId, r.versionId, r.clientId, r.requestedBy ?? IDS.designer,
     r.approverId ?? defaultApprover(r.clientId), r.submissionId ?? next()],
  );
  return id;
}

export const sha256Hex = (seed: string): string => {
  // Hash falso porém válido (64 hex) para testes; o hash real é feito no servidor.
  const hex = Buffer.from(seed).toString("hex").padEnd(64, "0").slice(0, 64);
  return hex;
};

/** Hashes determinísticos de teste para o fluxo de link (o servidor real usa HMAC). */
export const codeHashOf = (token: string): string => sha256Hex(`code-${token}`);
export const sessionHashOf = (token: string): string => sha256Hex(`sess-${token}`);

/** Percorre o fluxo do servidor: emite o código e o confere, abrindo a sessão do link. */
export async function openLinkSession(db: TestDb, token: string): Promise<{ tokenHash: string; sessionHash: string }> {
  const tokenHash = sha256Hex(token);
  await db.asService(async () => {
    const issued = await db.query<{ r: { status: string } }>("select public.link_issue_code($1, $2) as r", [tokenHash, codeHashOf(token)]);
    if (issued.rows[0].r.status !== "ok") throw new Error(`código não emitido: ${issued.rows[0].r.status}`);
    const checked = await db.query<{ r: { status: string } }>("select public.link_verify_code($1, $2, $3) as r", [tokenHash, codeHashOf(token), sessionHashOf(token)]);
    if (checked.rows[0].r.status !== "ok") throw new Error(`código recusado: ${checked.rows[0].r.status}`);
  });
  return { tokenHash, sessionHash: sessionHashOf(token) };
}

/** Executa e devolve a mensagem de erro (ou null se não falhou). */
export async function errorOf(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}
