-- Aprova Luvi — Fase 2, migration 1/4: esquema principal.
--
-- Princípios:
--   * Nenhum dado de decisão ou auditoria é apagado ou editado (triggers de imutabilidade).
--   * Toda tabela de negócio carrega client_id; chaves estrangeiras compostas impedem
--     que um registro aponte para pais de clientes diferentes.
--   * Nada é removido em cascata: arquivar é "active = false".
--   * Tabelas de segredos (verificações e sessões de link) só são acessíveis pelo servidor
--     (service_role); as políticas e grants estão na migration 3.

create schema if not exists app;

-- Privilégios PADRÃO: no Supabase, tudo que é criado em "public" nasce com ALL para anon e
-- authenticated. Revogamos isso ANTES de criar qualquer objeto, e vale também para objetos de
-- migrations futuras: tabelas e sequências nunca ficam acessíveis sem um GRANT explícito.
--
-- LIMITAÇÃO conhecida do Postgres: funções novas continuam com EXECUTE implícito para PUBLIC
-- (e, por herança, para anon). ALTER DEFAULT PRIVILEGES ... IN SCHEMA não remove esse padrão, e
-- revogá-lo globalmente quebraria extensões. Por isso TODA função nova precisa de
--   revoke execute on function ... from public, anon;
-- na própria migration. O teste src/test/db/privileges.test.ts falha se alguma função de
-- public/app ficar executável por anon ou por authenticated fora da lista permitida.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema app revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'designer', 'atendimento', 'cliente');
create type public.material_type as enum ('imagem', 'carrossel', 'video', 'pdf');
create type public.material_status as enum ('rascunho', 'aguardando', 'alteracao', 'aprovado');
create type public.project_status as enum ('ativo', 'pausado', 'concluido');
create type public.request_status as enum ('aberta', 'decidida', 'cancelada');
create type public.decision_kind as enum ('aprovado', 'alteracao');
create type public.decision_channel as enum ('portal', 'link');
create type public.file_kind as enum ('imagem', 'video', 'pdf');
create type public.author_role as enum ('luvi', 'cliente');

-- ---------------------------------------------------------------------------
-- Funções de trigger genéricas
-- ---------------------------------------------------------------------------
create function app.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function app.forbid_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'registro imutável: % em % não é permitido', tg_op, tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

-- ---------------------------------------------------------------------------
-- Organizações e usuários
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  created_at timestamptz not null default now()
);

-- Um perfil por usuário do Supabase Auth. NÃO há trigger de auto-criação: cadastro livre
-- não pode gerar acesso. Perfis são criados pelo servidor (service_role) após convite.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id),
  full_name text not null check (char_length(btrim(full_name)) between 2 and 120),
  email text not null unique check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.app_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_organization_id_idx on public.profiles (organization_id);
create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Clientes e aprovadores
-- ---------------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  segment text not null default '' check (char_length(segment) <= 120),
  initials text not null check (initials ~ '^[A-Z0-9]{1,3}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);
create index clients_organization_id_idx on public.clients (organization_id);
create trigger clients_touch before update on public.clients
  for each row execute function app.touch_updated_at();

-- Aprovador: pessoa do cliente que decide. Com profile_id tem login no portal; sem ele
-- só decide por link seguro (com verificação por código enviado ao e-mail).
create table public.approvers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  profile_id uuid unique references public.profiles (id) on delete set null,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  job_title text not null default '' check (char_length(job_title) <= 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (client_id, email),
  unique (id, client_id)
);
create index approvers_client_id_idx on public.approvers (client_id);

create function app.approvers_check_profile() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.profile_id is not null and not exists (
    select 1
    from public.profiles p
    join public.clients c on c.organization_id = p.organization_id
    where p.id = new.profile_id and p.role = 'cliente' and c.id = new.client_id
  ) then
    raise exception 'o perfil vinculado ao aprovador deve ter papel "cliente" na mesma organização';
  end if;
  return new;
end;
$$;
create trigger approvers_check_profile before insert or update on public.approvers
  for each row execute function app.approvers_check_profile();

-- ---------------------------------------------------------------------------
-- Projetos e materiais
-- ---------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  name text not null check (char_length(btrim(name)) between 2 and 160),
  description text not null default '' check (char_length(description) <= 2000),
  status public.project_status not null default 'ativo',
  due_date date,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, client_id)
);
create index projects_client_id_idx on public.projects (client_id);
create trigger projects_touch before update on public.projects
  for each row execute function app.touch_updated_at();

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  client_id uuid not null references public.clients (id),
  title text not null check (char_length(btrim(title)) between 2 and 200),
  description text not null default '' check (char_length(description) <= 2000),
  type public.material_type not null,
  channel text not null default '' check (char_length(channel) <= 120),
  -- Só funções do banco alteram o status (colunas fora do grant de UPDATE do app).
  status public.material_status not null default 'rascunho',
  due_date date,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, client_id),
  foreign key (project_id, client_id) references public.projects (id, client_id)
);
create index materials_client_id_idx on public.materials (client_id);
create index materials_project_id_idx on public.materials (project_id);
create index materials_status_idx on public.materials (status);
create trigger materials_touch before update on public.materials
  for each row execute function app.touch_updated_at();

-- Versões: imutáveis. Uma nova versão nunca apaga a anterior.
create table public.material_versions (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null,
  client_id uuid not null,
  number integer not null check (number > 0),
  note text not null default '' check (char_length(note) <= 2000),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (material_id, number),
  unique (id, material_id, client_id),
  foreign key (material_id, client_id) references public.materials (id, client_id)
);
create index material_versions_client_id_idx on public.material_versions (client_id);

create function app.versions_before_insert() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Triggers BEFORE rodam antes da RLS: sem esta checagem, as mensagens abaixo serviam de
  -- oráculo sobre materiais de outros clientes. auth.uid() nulo = servidor de confiança.
  if auth.uid() is not null and not app.staff_can_access(new.client_id) then
    raise exception 'new row violates row-level security policy for table "%"', tg_table_name
      using errcode = '42501';
  end if;
  perform 1 from public.materials m
    where m.id = new.material_id and m.client_id = new.client_id for update;
  if not found then
    raise exception 'material inválido para esta versão';
  end if;
  if exists (
    select 1 from public.approval_requests r
    where r.material_id = new.material_id and r.status = 'aberta'
  ) then
    raise exception 'há uma solicitação de aprovação aberta: cancele-a antes de criar uma nova versão';
  end if;
  new.number := coalesce(
    (select max(v.number) from public.material_versions v where v.material_id = new.material_id), 0
  ) + 1;
  update public.materials set status = 'rascunho' where id = new.material_id and status <> 'rascunho';
  return new;
end;
$$;

-- Arquivos: um por slide. O caminho no storage começa por "{client_id}/", o que liga a
-- política do bucket ao isolamento por cliente.
create table public.material_files (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null,
  material_id uuid not null,
  client_id uuid not null,
  slide_position integer not null check (slide_position >= 1),
  kind public.file_kind not null,
  storage_path text not null unique,
  original_name text not null check (char_length(original_name) between 1 and 255),
  mime_type text not null check (mime_type in (
    'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'application/pdf'
  )),
  size_bytes bigint not null check (size_bytes > 0),
  checksum_sha256 text check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (version_id, slide_position),
  foreign key (version_id, material_id, client_id)
    references public.material_versions (id, material_id, client_id),
  check (storage_path like client_id::text || '/%'),
  check (
    (kind = 'imagem' and mime_type like 'image/%' and size_bytes <= 20971520) or
    (kind = 'video' and mime_type like 'video/%' and size_bytes <= 52428800) or
    (kind = 'pdf' and mime_type = 'application/pdf' and size_bytes <= 52428800)
  )
);
create index material_files_client_id_idx on public.material_files (client_id);
create index material_files_version_id_idx on public.material_files (version_id);

-- ---------------------------------------------------------------------------
-- Solicitações de aprovação e links seguros
-- ---------------------------------------------------------------------------
create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null,
  version_id uuid not null,
  client_id uuid not null,
  requested_by uuid references public.profiles (id),
  status public.request_status not null default 'aberta',
  due_at timestamptz,
  message text not null default '' check (char_length(message) <= 2000),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (id, client_id),
  foreign key (version_id, material_id, client_id)
    references public.material_versions (id, material_id, client_id),
  check ((status = 'aberta') = (closed_at is null))
);
-- Só uma solicitação aberta por versão.
create unique index approval_requests_one_open_per_version
  on public.approval_requests (version_id) where status = 'aberta';
create index approval_requests_client_id_idx on public.approval_requests (client_id);
create index approval_requests_material_id_idx on public.approval_requests (material_id);

create function app.requests_before_insert() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  latest integer;
  v_number integer;
begin
  if auth.uid() is not null and not app.staff_can_access(new.client_id) then
    raise exception 'new row violates row-level security policy for table "%"', tg_table_name
      using errcode = '42501';
  end if;
  select v.number into v_number from public.material_versions v where v.id = new.version_id;
  select max(v.number) into latest from public.material_versions v where v.material_id = new.material_id;
  if v_number is distinct from latest then
    raise exception 'somente a versão mais recente pode ser enviada para aprovação';
  end if;
  if not exists (select 1 from public.material_files f where f.version_id = new.version_id) then
    raise exception 'a versão não possui arquivos';
  end if;
  new.status := 'aberta';
  new.closed_at := null;
  return new;
end;
$$;
create trigger requests_before_insert before insert on public.approval_requests
  for each row execute function app.requests_before_insert();

create function app.requests_after_insert() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.materials set status = 'aguardando' where id = new.material_id;
  return new;
end;
$$;
create trigger requests_after_insert after insert on public.approval_requests
  for each row execute function app.requests_after_insert();

-- O banco guarda apenas o HASH (sha256 hex) do token. O token em si existe só na URL enviada.
create table public.approval_links (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  client_id uuid not null,
  approver_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id),
  used_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  foreign key (request_id, client_id) references public.approval_requests (id, client_id),
  foreign key (approver_id, client_id) references public.approvers (id, client_id),
  unique (id, client_id)
);
create index approval_links_request_id_idx on public.approval_links (request_id);
create index approval_links_client_id_idx on public.approval_links (client_id);

-- Códigos temporários de verificação de identidade (hash do código, nunca o código).
create table public.approval_verifications (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.approval_links (id),
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index approval_verifications_link_id_idx on public.approval_verifications (link_id);

-- Sessões curtas criadas após a verificação (hash do identificador guardado no cookie).
create table public.approval_link_sessions (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.approval_links (id),
  session_hash text not null unique check (session_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index approval_link_sessions_link_id_idx on public.approval_link_sessions (link_id);

-- ---------------------------------------------------------------------------
-- Comentários e decisões
-- ---------------------------------------------------------------------------
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null,
  version_id uuid not null,
  client_id uuid not null,
  slide integer check (slide is null or slide >= 1),
  author_role public.author_role not null,
  author_profile_id uuid references public.profiles (id),
  author_approver_id uuid,
  author_name text not null default '',
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  foreign key (version_id, material_id, client_id)
    references public.material_versions (id, material_id, client_id),
  foreign key (author_approver_id, client_id) references public.approvers (id, client_id),
  check (
    (author_role = 'luvi' and author_profile_id is not null and author_approver_id is null) or
    (author_role = 'cliente' and author_approver_id is not null and author_profile_id is null)
  )
);
create index comments_material_id_idx on public.comments (material_id, created_at);
create index comments_client_id_idx on public.comments (client_id);

-- O nome do autor vem do cadastro, nunca do cliente HTTP (evita falsificação).
create function app.comments_set_author() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.author_role = 'luvi' then
    select p.full_name into new.author_name from public.profiles p where p.id = new.author_profile_id;
  else
    select a.name into new.author_name from public.approvers a where a.id = new.author_approver_id;
  end if;
  new.body := btrim(new.body);
  return new;
end;
$$;
create trigger comments_set_author before insert on public.comments
  for each row execute function app.comments_set_author();
create trigger comments_immutable before update or delete on public.comments
  for each row execute function app.forbid_change();

-- Decisões: registro imutável, uma por solicitação.
create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  material_id uuid not null,
  version_id uuid not null,
  client_id uuid not null,
  decision public.decision_kind not null,
  note text not null default '' check (char_length(note) <= 4000),
  approver_id uuid not null,
  via public.decision_channel not null,
  link_id uuid,
  ip_hash text,
  user_agent text check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  unique (request_id),
  foreign key (request_id, client_id) references public.approval_requests (id, client_id),
  foreign key (version_id, material_id, client_id)
    references public.material_versions (id, material_id, client_id),
  foreign key (approver_id, client_id) references public.approvers (id, client_id),
  foreign key (link_id, client_id) references public.approval_links (id, client_id),
  check (decision = 'aprovado' or char_length(btrim(note)) >= 10),
  check ((via = 'link') = (link_id is not null))
);
create index decisions_client_id_idx on public.decisions (client_id);
create index decisions_material_id_idx on public.decisions (material_id);
create trigger decisions_immutable before update or delete on public.decisions
  for each row execute function app.forbid_change();
create trigger decisions_no_truncate before truncate on public.decisions
  for each statement execute function app.forbid_change();

create trigger versions_before_insert before insert on public.material_versions
  for each row execute function app.versions_before_insert();
create trigger versions_immutable before update or delete on public.material_versions
  for each row execute function app.forbid_change();

-- ---------------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id),
  actor_profile_id uuid references public.profiles (id),
  actor_approver_id uuid references public.approvers (id),
  action text not null check (char_length(action) between 3 and 80),
  entity_type text not null check (char_length(entity_type) between 2 and 60),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  ip_hash text,
  created_at timestamptz not null default now()
);
create index audit_events_org_created_idx on public.audit_events (organization_id, created_at desc);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id);
create trigger audit_events_immutable before update or delete on public.audit_events
  for each row execute function app.forbid_change();
create trigger audit_events_no_truncate before truncate on public.audit_events
  for each statement execute function app.forbid_change();

create function app.write_audit(
  p_client_id uuid,
  p_actor_profile_id uuid,
  p_actor_approver_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb default '{}'::jsonb,
  p_ip_hash text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_events (
    organization_id, actor_profile_id, actor_approver_id, action, entity_type, entity_id, metadata, ip_hash
  )
  select c.organization_id, p_actor_profile_id, p_actor_approver_id, p_action, p_entity_type,
         p_entity_id, coalesce(p_metadata, '{}'::jsonb), p_ip_hash
  from public.clients c where c.id = p_client_id;
end;
$$;

-- Auditoria automática de criação de versões, arquivos e solicitações.
create function app.audit_insert() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.write_audit(
    new.client_id, auth.uid(), null, tg_argv[0], tg_argv[1], new.id,
    jsonb_build_object('material_id', new.material_id)
  );
  return new;
end;
$$;
create trigger versions_audit after insert on public.material_versions
  for each row execute function app.audit_insert('version.created', 'material_version');
create trigger files_audit after insert on public.material_files
  for each row execute function app.audit_insert('file.added', 'material_file');
create trigger requests_audit after insert on public.approval_requests
  for each row execute function app.audit_insert('approval_request.created', 'approval_request');
