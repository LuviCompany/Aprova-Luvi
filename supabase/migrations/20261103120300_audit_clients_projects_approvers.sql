-- Aprova Luvi — Módulo 3, etapa A.2, migration M4/4: auditoria de clientes, projetos, aprovadores
-- e convites.
--
-- Cada evento grava, em public.audit_events (imutável): a ORGANIZAÇÃO, o RESPONSÁVEL
-- (actor_profile_id = auth.uid(); nulo quando é o servidor), o REGISTRO AFETADO (entity_type +
-- entity_id), o TIPO DA AÇÃO e a DATA/HORA (created_at).
--
-- Dados pessoais: a auditoria é imutável e não pode ser apagada depois, então NÃO grava nome,
-- e-mail nem texto livre. O metadata tem só ids, o PAPEL do responsável no momento (admin,
-- atendimento…), os NOMES DAS COLUNAS alteradas e, para status/ativo, o valor anterior e o novo.
-- Atualizações que só mexem em updated_at não geram evento.

create function app.audit_row_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity text;
  v_client uuid;
  v_action text;
  v_override text := nullif(current_setting('app.audit_action', true), '');
  v_changed text[];
  v_meta jsonb;
begin
  case tg_table_name
    when 'clients' then v_entity := 'client'; v_client := new.id;
    when 'projects' then v_entity := 'project'; v_client := new.client_id;
    when 'approvers' then v_entity := 'approver'; v_client := new.client_id;
    when 'approver_invites' then v_entity := 'approver_invite'; v_client := new.client_id;
    else raise exception 'tabela não auditada: %', tg_table_name;
  end case;

  v_meta := jsonb_build_object('client_id', v_client, 'actor_role', app.my_role());

  if tg_op = 'INSERT' then
    v_action := coalesce(v_override, case v_entity when 'approver_invite' then 'approver_invite.prepared'
                                                    else v_entity || '.created' end);
  else
    select array_agg(n.key order by n.key) into v_changed
    from jsonb_each(to_jsonb(new)) n
    where n.key <> 'updated_at' and (to_jsonb(old) -> n.key) is distinct from n.value;
    if v_changed is null then
      return new; -- só updated_at mudou
    end if;
    v_meta := v_meta || jsonb_build_object('changed', to_jsonb(v_changed));

    if v_entity = 'client' then
      v_action := case when old.active and not new.active then 'client.archived'
                       when not old.active and new.active then 'client.reactivated'
                       else 'client.updated' end;
    elsif v_entity = 'project' then
      v_action := 'project.updated';
      if old.status is distinct from new.status then
        v_meta := v_meta || jsonb_build_object('status_from', old.status, 'status_to', new.status);
      end if;
    elsif v_entity = 'approver' then
      v_action := case when old.active and not new.active then 'approver.deactivated'
                       when not old.active and new.active then 'approver.reactivated'
                       else 'approver.updated' end;
    else
      v_action := 'approver_invite.' || case new.status
        when 'enviado' then 'sent' when 'aceito' then 'accepted' when 'revogado' then 'revoked'
        when 'expirado' then 'expired' else 'updated' end;
      if old.status is distinct from new.status then
        v_meta := v_meta || jsonb_build_object('status_from', old.status, 'status_to', new.status);
      end if;
    end if;
  end if;

  perform app.write_audit(v_client, auth.uid(), null, v_action, v_entity, new.id, v_meta);
  return new;
end;
$$;
revoke execute on function app.audit_row_change() from public, anon, authenticated;

create trigger clients_audit_row after insert or update on public.clients
  for each row execute function app.audit_row_change();
create trigger projects_audit_row after insert or update on public.projects
  for each row execute function app.audit_row_change();
create trigger approvers_audit_row after insert or update on public.approvers
  for each row execute function app.audit_row_change();
create trigger approver_invites_audit_row after insert or update on public.approver_invites
  for each row execute function app.audit_row_change();
