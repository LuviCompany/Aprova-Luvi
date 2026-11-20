-- Aprova Luvi — migration 17: membros da equipe (administrador, designer, atendimento) convidados pelo painel.
--
-- Hoje só o terminal (scripts/bootstrap-admin) cria o primeiro administrador. Esta migration permite que um
-- ADMINISTRADOR ATIVO convide outros membros da equipe pelo painel, com as regras no BANCO (não só no código) e
-- com registro de auditoria de quem convidou.
--
-- Como funciona (o servidor cria o usuário no Auth e manda o e-mail; o PERFIL só entra por aqui):
--   1. o servidor cria o usuário no Auth (convite, sem senha) e obtém o id;
--   2. o servidor chama public.add_team_member COM A SESSÃO DO ADMINISTRADOR (não com a chave secreta);
--   3. a função confere TUDO no banco e só então cria o perfil e grava a auditoria com o administrador como autor.
--
-- public.add_team_member(p_user_id, p_full_name, p_email, p_role) -> uuid
--   - quem chama: administrador ATIVO (app.is_admin()); designer, atendimento, cliente, inativo, anônimo e service_role são recusados (42501);
--   - a organização é SEMPRE a do administrador (app.my_org()): não é parâmetro, nunca se cria outra organização;
--   - papel só admin, designer ou atendimento (nunca cliente, que tem fluxo próprio) (22023);
--   - o id e o e-mail precisam ser do MESMO usuário do Auth, ainda não ativado: sem e-mail confirmado e sem login (22023). Isso
--     impede anexar o papel a uma conta já em uso e a qualquer id inventado;
--   - e-mail único (minúsculas) e id único: duplicado vira unique_violation (23505);
--   - auditoria: team_member.invited, com o administrador como autor e metadata só com papel (role) e papel do autor (actor_role):
--     sem nome, e-mail, token, senha nem link.
--
-- public.reserve_team_invite_resend(p_user_id) -> (r_full_name, r_email, r_role)
--   - reserva o reenvio do convite: administrador ativo, membro da equipe da MESMA organização (nunca cliente), no máximo 1 por
--     minuto (conta o último convite ou reenvio na auditoria, de forma atômica); grava team_member.invite_resent. O servidor só
--     reenvia depois de conferir no Auth que a conta ainda não foi ativada.
--
-- Papel de um membro NÃO muda nesta etapa: nenhuma função altera profiles.role e o app continua sem UPDATE nessa coluna.
-- Esta migration não cria tabelas, não altera RLS, políticas nem os privilégios de tabela de nenhum papel.

-- Escrita de auditoria no nível da ORGANIZAÇÃO (o write_audit existente deriva a organização de um cliente).
-- Interna: só as funções SECURITY DEFINER abaixo a chamam.
create function app.write_org_audit(
  p_organization_id uuid,
  p_actor_profile_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_events (organization_id, actor_profile_id, action, entity_type, entity_id, metadata)
  values (p_organization_id, p_actor_profile_id, p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

create function public.add_team_member(
  p_user_id uuid,
  p_full_name text,
  p_email text,
  p_role public.app_role
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_name text := btrim(coalesce(p_full_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  -- 1) quem chama: administrador ATIVO
  if v_actor is null or not app.is_admin() then
    raise exception 'sem permissão para adicionar membros da equipe' using errcode = '42501';
  end if;
  v_org := app.my_org();
  if v_org is null then
    raise exception 'sem permissão para adicionar membros da equipe' using errcode = '42501';
  end if;

  -- 2) papel permitido
  if p_role is null or p_role not in ('admin', 'designer', 'atendimento') then
    raise exception 'papel inválido para a equipe' using errcode = '22023';
  end if;

  -- 3) dados
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'nome inválido' using errcode = '22023';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'e-mail inválido' using errcode = '22023';
  end if;

  -- 4) o id e o e-mail são do MESMO usuário do Auth, ainda não ativado
  perform 1
    from auth.users u
   where u.id = p_user_id
     and lower(u.email) = v_email
     and u.email_confirmed_at is null
     and u.last_sign_in_at is null;
  if not found then
    raise exception 'o usuário do Auth não confere com o convite' using errcode = '22023';
  end if;

  -- 5) perfil na organização DO ADMINISTRADOR (id e e-mail únicos: duplicado vira 23505)
  insert into public.profiles (id, organization_id, full_name, email, role)
  values (p_user_id, v_org, v_name, v_email, p_role);

  -- 6) auditoria: quem convidou e qual papel; nenhum dado pessoal, token, senha ou link
  perform app.write_org_audit(
    v_org, v_actor, 'team_member.invited', 'profile', p_user_id,
    jsonb_build_object('role', p_role::text, 'actor_role', 'admin')
  );
  return p_user_id;
end;
$$;

create function public.reserve_team_invite_resend(p_user_id uuid)
returns table (r_full_name text, r_email text, r_role public.app_role)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_last timestamptz;
begin
  if v_actor is null or not app.is_admin() then
    raise exception 'sem permissão para reenviar convites da equipe' using errcode = '42501';
  end if;
  v_org := app.my_org();
  if v_org is null then
    raise exception 'sem permissão para reenviar convites da equipe' using errcode = '42501';
  end if;

  select p.full_name, p.email, p.role
    into r_full_name, r_email, r_role
    from public.profiles p
   where p.id = p_user_id
     and p.organization_id = v_org
     and p.role in ('admin', 'designer', 'atendimento');
  if not found then
    raise exception 'membro da equipe não encontrado' using errcode = 'P0002';
  end if;

  -- no máximo 1 convite ou reenvio por minuto, por pessoa (a auditoria é imutável, então a conta é confiável)
  select max(a.created_at)
    into v_last
    from public.audit_events a
   where a.organization_id = v_org
     and a.entity_type = 'profile'
     and a.entity_id = p_user_id
     and a.action in ('team_member.invited', 'team_member.invite_resent');
  if v_last is not null and v_last > now() - interval '1 minute' then
    raise exception 'aguarde um minuto antes de reenviar o convite' using errcode = 'P0001';
  end if;

  perform app.write_org_audit(
    v_org, v_actor, 'team_member.invite_resent', 'profile', p_user_id,
    jsonb_build_object('role', r_role::text, 'actor_role', 'admin')
  );
  return next;
end;
$$;

-- EXECUTE: o Postgres abre EXECUTE a PUBLIC por padrão; fecha tudo e abre só o necessário.
revoke all on function app.write_org_audit(uuid, uuid, text, text, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.add_team_member(uuid, text, text, public.app_role) from public, anon, service_role;
revoke all on function public.reserve_team_invite_resend(uuid) from public, anon, service_role;
grant execute on function public.add_team_member(uuid, text, text, public.app_role) to authenticated;
grant execute on function public.reserve_team_invite_resend(uuid) to authenticated;
