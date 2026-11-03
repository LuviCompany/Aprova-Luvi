-- Aprova Luvi — Módulo 3, etapa B, migration B1/2: conteúdo do material e travas de integridade.
--
-- 1) Colunas novas em public.materials: legenda (caption), proporção (aspect_ratio) e data
--    prevista de publicação (publish_date). `due_date` continua sendo o PRAZO DE APROVAÇÃO.
-- 2) Grants por coluna: o app (authenticated) passa a gravar só as três colunas novas, além das
--    que já gravava. Ficam FORA de qualquer UPDATE do app: id, project_id, client_id, type, status,
--    created_by, created_at e updated_at. status só muda pelas funções de aprovação.
-- 3) Trava de conteúdo: depois que o material sai de "rascunho" (enviado, com alteração pedida
--    ou aprovado), título, descrição, legenda, canal e proporção NÃO mudam mais. As datas
--    (due_date e publish_date) continuam editáveis (reagendar não altera a arte nem o texto).
-- 4) Material novo não pode ser cadastrado em cliente arquivado (mesma guarda de projetos e
--    aprovadores, vale também para o service_role).
-- 5) Material APROVADO não volta a rascunho por uma simples nova versão: a criação de versão
--    sobre material aprovado exige a operação explícita de revisão (a ser criada com as versões,
--    etapa D), que sinaliza `app.revision_in_progress = 'on'` dentro da própria transação.

alter table public.materials
  add column caption text not null default '' check (char_length(caption) <= 2200),
  add column aspect_ratio text check (aspect_ratio in ('1:1', '4:5', '9:16', 'outro')),
  add column publish_date date;

-- A coluna nova entra no SELECT de authenticated pelo grant de tabela que já existe.
grant insert (caption, aspect_ratio, publish_date) on public.materials to authenticated;
grant update (caption, aspect_ratio, publish_date) on public.materials to authenticated;

create function app.materials_guard_content() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Só compara OLD e NEW (não lê outras tabelas): não serve de oráculo sobre outros clientes,
  -- mesmo rodando antes da RLS.
  if old.status <> 'rascunho' and (
       new.title is distinct from old.title
    or new.description is distinct from old.description
    or new.caption is distinct from old.caption
    or new.channel is distinct from old.channel
    or new.aspect_ratio is distinct from old.aspect_ratio
  ) then
    raise exception 'material já enviado para aprovação: o conteúdo só muda numa nova revisão'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function app.materials_guard_content() from public, anon, authenticated;

create trigger materials_guard_content before update on public.materials
  for each row execute function app.materials_guard_content();

create trigger materials_guard_active_client before insert on public.materials
  for each row execute function app.guard_active_client();

-- Mesma função da migration 1 (core_schema), com UMA regra a mais: material aprovado não ganha
-- versão nova sem a operação explícita de revisão.
create or replace function app.versions_before_insert() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.material_status;
begin
  -- Triggers BEFORE rodam antes da RLS: sem esta checagem, as mensagens abaixo serviam de
  -- oráculo sobre materiais de outros clientes. auth.uid() nulo = servidor de confiança.
  if auth.uid() is not null and not app.staff_can_access(new.client_id) then
    raise exception 'new row violates row-level security policy for table "%"', tg_table_name
      using errcode = '42501';
  end if;
  select m.status into v_status from public.materials m
    where m.id = new.material_id and m.client_id = new.client_id for update;
  if not found then
    raise exception 'material inválido para esta versão';
  end if;
  if v_status = 'aprovado' and coalesce(current_setting('app.revision_in_progress', true), '') <> 'on' then
    raise exception 'material aprovado: use a operação de revisão para criar uma nova versão'
      using errcode = '23514';
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
