-- Aprova Luvi — Módulo 3, etapas C e D, migration C2/2: conteúdo congelado por versão e operação de revisão.
--
-- 1) public.material_version_contents: cópia IMUTÁVEL do que o cliente vê de cada versão (título,
--    descrição, legenda, tipo, proporção, canal, datas e a lista dos arquivos), uma linha por versão.
--    Só app.freeze_version_content() grava (SECURITY DEFINER, sem EXECUTE para a API). Os campos são
--    os PRESENTED_FIELDS de src/lib/materials/schema.ts (há teste que compara).
-- 2) Quando congela: (a) ao CRIAR A SOLICITAÇÃO DE APROVAÇÃO da versão (o que o cliente recebeu), e
--    (b) quando uma versão nova é criada, a anterior ainda sem cópia é congelada (rascunho substituído).
--    Depois do envio o conteúdo do material já está travado (B1), então a cópia é fiel.
-- 3) public.start_material_revision(material, motivo): a operação EXPLÍCITA de revisão. Cria a próxima
--    versão de um material aprovado ou com alteração pedida, devolvendo-o a rascunho, sem tocar nas versões,
--    arquivos, solicitações, decisões nem cópias anteriores. Para material aprovado emite o tíquete
--    (app.grant_revision_ticket, B1) na mesma transação. Só equipe com acesso ao cliente; o motivo
--    fica na nota (imutável) da nova versão e a auditoria NÃO leva o texto do motivo.

create table public.material_version_contents (
  version_id uuid primary key,
  material_id uuid not null,
  client_id uuid not null,
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  frozen_at timestamptz not null default now(),
  foreign key (version_id, material_id, client_id)
    references public.material_versions (id, material_id, client_id)
);
create index material_version_contents_client_id_idx on public.material_version_contents (client_id);

alter table public.material_version_contents enable row level security;
revoke all on table public.material_version_contents from anon, authenticated;
grant select on public.material_version_contents to authenticated;

create policy version_contents_select_staff on public.material_version_contents
  for select to authenticated
  using (app.staff_can_access(client_id));
create policy version_contents_select_portal on public.material_version_contents
  for select to authenticated
  using (client_id in (select app.my_client_ids()) and app.version_was_sent(version_id));

create trigger version_contents_immutable before update or delete on public.material_version_contents
  for each row execute function app.forbid_change();
create trigger version_contents_no_truncate before truncate on public.material_version_contents
  for each statement execute function app.forbid_change();

create function app.freeze_version_content(p_version_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.material_version_contents (version_id, material_id, client_id, content)
  select v.id, v.material_id, v.client_id,
         jsonb_build_object(
           'title', m.title,
           'description', m.description,
           'caption', m.caption,
           'type', m.type,
           'aspect_ratio', m.aspect_ratio,
           'channel', m.channel,
           'publish_date', m.publish_date,
           'due_date', m.due_date,
           'files', coalesce((
             select jsonb_agg(jsonb_build_object(
               'position', f.slide_position, 'kind', f.kind, 'mime_type', f.mime_type,
               'original_name', f.original_name, 'size_bytes', f.size_bytes,
               'checksum_sha256', f.checksum_sha256
             ) order by f.slide_position)
             from public.material_files f where f.version_id = v.id
           ), '[]'::jsonb)
         )
  from public.material_versions v
  join public.materials m on m.id = v.material_id and m.client_id = v.client_id
  where v.id = p_version_id
  on conflict (version_id) do nothing;
end;
$$;
revoke execute on function app.freeze_version_content(uuid) from public, anon, authenticated, service_role;

create function app.requests_freeze_content() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.freeze_version_content(new.version_id);
  return new;
end;
$$;
revoke execute on function app.requests_freeze_content() from public, anon, authenticated, service_role;
create trigger requests_freeze_content after insert on public.approval_requests
  for each row execute function app.requests_freeze_content();

-- Mesma função da B1, com UMA coisa a mais: congela o conteúdo da versão anterior antes de criar a próxima.
create or replace function app.versions_before_insert() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.material_status;
  v_prev uuid;
begin
  if auth.uid() is not null and not app.staff_can_access(new.client_id) then
    raise exception 'new row violates row-level security policy for table "%"', tg_table_name
      using errcode = '42501';
  end if;
  select m.status into v_status from public.materials m
    where m.id = new.material_id and m.client_id = new.client_id for update;
  if not found then
    raise exception 'material inválido para esta versão';
  end if;
  if v_status = 'aprovado' and not app.has_revision_ticket(new.material_id) then
    raise exception 'material aprovado: use a operação de revisão para criar uma nova versão'
      using errcode = '23514';
  end if;
  if exists (
    select 1 from public.approval_requests r
    where r.material_id = new.material_id and r.status = 'aberta'
  ) then
    raise exception 'há uma solicitação de aprovação aberta: cancele-a antes de criar uma nova versão';
  end if;
  select v.id into v_prev from public.material_versions v
    where v.material_id = new.material_id order by v.number desc limit 1;
  if v_prev is not null then
    perform app.freeze_version_content(v_prev);
  end if;
  new.number := coalesce(
    (select max(v.number) from public.material_versions v where v.material_id = new.material_id), 0
  ) + 1;
  update public.materials set status = 'rascunho' where id = new.material_id and status <> 'rascunho';
  return new;
end;
$$;

create function public.start_material_revision(p_material_id uuid, p_reason text) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client uuid;
  v_status public.material_status;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_version uuid;
begin
  select m.client_id, m.status into v_client, v_status
  from public.materials m where m.id = p_material_id for update;
  if v_client is null or auth.uid() is null or not app.staff_can_access(v_client) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if v_status not in ('aprovado', 'alteracao') then
    raise exception 'só material aprovado ou com alteração pedida pode entrar em revisão' using errcode = '23514';
  end if;
  if char_length(v_reason) not between 10 and 500 then
    raise exception 'informe o motivo da revisão (de 10 a 500 caracteres)' using errcode = '22023';
  end if;
  if v_status = 'aprovado' then
    perform app.grant_revision_ticket(p_material_id);
  end if;
  insert into public.material_versions (material_id, client_id, note, created_by)
  values (p_material_id, v_client, v_reason, auth.uid())
  returning id into v_version;
  perform app.write_audit(
    v_client, auth.uid(), null, 'material.revision_started', 'material', p_material_id,
    jsonb_build_object('client_id', v_client, 'actor_role', app.my_role(), 'status_from', v_status, 'status_to', 'rascunho')
  );
  return v_version;
end;
$$;
revoke execute on function public.start_material_revision(uuid, text) from public, anon;
grant execute on function public.start_material_revision(uuid, text) to authenticated;
