-- Aprova Luvi — Módulo 3, etapa A.2, migration M1/4: integridade de clientes e projetos.
--
--   * Projeto ou aprovador NOVO só pode ser criado em cliente ATIVO (antes só a Server Action
--     recusava; a policy de INSERT não olhava clients.active).
--   * Nome de cliente único por organização SEM diferenciar maiúsculas/minúsculas nem espaços
--     repetidos ("Casa Aurora" = "casa  aurora").
--
-- Aditiva: não altera nem remove nada que já existe. Dados antigos não são mexidos; o índice
-- falha (e a migration inteira desfaz) se já existirem nomes duplicados nessa regra.
-- Antes de aplicar, conferir que não há duplicados:
--   select organization_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')), count(*)
--   from public.clients group by 1, 2 having count(*) > 1;

-- BEFORE INSERT roda ANTES da RLS: sem checar o acesso primeiro, a mensagem "cliente arquivado"
-- viraria um oráculo sobre clientes de outras organizações (mesma lição de versions_before_insert).
-- auth.uid() nulo = servidor de confiança (service_role): a regra do arquivamento vale para ele também.
create function app.guard_active_client() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not app.staff_can_access(new.client_id) then
    raise exception 'new row violates row-level security policy for table "%"', tg_table_name
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.clients c where c.id = new.client_id and c.active) then
    raise exception 'cliente arquivado: reative o cliente antes de cadastrar em %', tg_table_name
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function app.guard_active_client() from public, anon, authenticated;

create trigger projects_guard_active_client before insert on public.projects
  for each row execute function app.guard_active_client();
create trigger approvers_guard_active_client before insert on public.approvers
  for each row execute function app.guard_active_client();

-- A restrição antiga unique (organization_id, name) permanece. Não trata acentos (unaccent não é
-- imutável): "Casa" e "Cása" continuam sendo nomes diferentes.
create unique index clients_org_name_ci_key
  on public.clients (organization_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));
