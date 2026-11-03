-- Aprova Luvi — Módulo 3, etapa A.2, migration M2/4: aprovador em vários clientes.
--
-- Modelo (Opção 1): UMA LINHA de approvers por cliente; o mesmo login (profile_id) pode estar em
-- várias linhas, uma por cliente. Os ids e as chaves compostas continuam valendo, então decisões,
-- links e comentários anteriores (imutáveis) não mudam.
--
--   * unique (profile_id) vira unique (profile_id, client_id)
--   * public.link_approver_to_client: vincula uma pessoa já cadastrada a outro cliente (profile_id
--     continua fora dos grants do app; só uma função do banco o copia)
--   * desativar o aprovador REVOGA os links pendentes dele (o histórico de decisões não é tocado)
--   * o e-mail do aprovador precisa ser o do login vinculado (comparação normalizada)

alter table public.approvers drop constraint approvers_profile_id_key;
-- profile_id nulo (só link, sem login) continua permitido em várias linhas: NULL não colide em unique.
alter table public.approvers add constraint approvers_profile_client_key unique (profile_id, client_id);

-- Substitui a função da migration 1: mesma verificação de papel/organização + e-mail igual ao do login.
create or replace function app.approvers_check_profile() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if new.profile_id is not null then
    if not exists (
      select 1
      from public.profiles p
      join public.clients c on c.organization_id = p.organization_id
      where p.id = new.profile_id and p.role = 'cliente' and c.id = new.client_id
    ) then
      raise exception 'o perfil vinculado ao aprovador deve ter papel "cliente" na mesma organização';
    end if;
    select p.email into v_email from public.profiles p where p.id = new.profile_id;
    if lower(btrim(v_email)) is distinct from lower(btrim(new.email)) then
      raise exception 'o e-mail do aprovador deve ser o mesmo do login vinculado';
    end if;
  end if;
  return new;
end;
$$;

-- Vincula a pessoa de um aprovador existente a OUTRO cliente da mesma organização.
create function public.link_approver_to_client(p_source_approver_id uuid, p_client_id uuid) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.approvers;
  v_id uuid;
begin
  if not app.can_manage_clients() or not app.staff_can_access(p_client_id) then
    raise exception 'sem permissão';
  end if;
  select a.* into s from public.approvers a where a.id = p_source_approver_id;
  -- Mesma resposta para "não existe" e "não é seu".
  if not found or not app.staff_can_access(s.client_id) then
    raise exception 'sem permissão';
  end if;
  if not s.active then
    raise exception 'aprovador de origem inativo';
  end if;
  if s.client_id = p_client_id then
    raise exception 'a origem e o destino são o mesmo cliente';
  end if;

  -- Marca a ação para a auditoria (M4) e limpa logo depois, para não vazar para outros comandos.
  perform set_config('app.audit_action', 'approver.linked', true);
  insert into public.approvers (client_id, profile_id, name, email, job_title, active)
  values (p_client_id, s.profile_id, s.name, s.email, s.job_title, true)
  returning id into v_id;
  perform set_config('app.audit_action', '', true);
  return v_id;
end;
$$;
revoke all on function public.link_approver_to_client(uuid, uuid) from public, anon;
grant execute on function public.link_approver_to_client(uuid, uuid) to authenticated, service_role;

-- Desativar o vínculo derruba os links ainda utilizáveis (não usados e não revogados).
-- Decisões já registradas, solicitações e comentários permanecem intactos.
create function app.approvers_after_deactivate() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.approval_links
     set revoked_at = now(), revoked_by = auth.uid()
   where approver_id = new.id and revoked_at is null and used_at is null;
  return new;
end;
$$;
revoke execute on function app.approvers_after_deactivate() from public, anon, authenticated;

create trigger approvers_after_deactivate after update of active on public.approvers
  for each row when (old.active and not new.active)
  execute function app.approvers_after_deactivate();

