-- Aprova Luvi — Módulo 3, etapa B, migration B2/2: auditoria de materiais.
--
-- Estende app.audit_row_change() (criada na A.2) para materiais e para EXCLUSÃO. Eventos:
-- material.created, material.updated (com os NOMES das colunas alteradas e, se o status mudou,
-- status_from/status_to) e material.deleted (com status_from). Como nos demais, o metadata não
-- leva título, legenda, descrição nem qualquer texto livre: só ids, o papel de quem agiu e
-- nomes de colunas. Atualizações que só mexem em updated_at não geram evento.

create or replace function app.audit_row_change() returns trigger
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
  if tg_op = 'DELETE' then
    -- Só materiais são auditados na exclusão (clientes, projetos e aprovadores nunca são apagados).
    if tg_table_name <> 'materials' then
      raise exception 'tabela não auditada na exclusão: %', tg_table_name;
    end if;
    perform app.write_audit(
      old.client_id, auth.uid(), null, 'material.deleted', 'material', old.id,
      jsonb_build_object('client_id', old.client_id, 'actor_role', app.my_role(), 'status_from', old.status)
    );
    return old;
  end if;

  case tg_table_name
    when 'clients' then v_entity := 'client'; v_client := new.id;
    when 'projects' then v_entity := 'project'; v_client := new.client_id;
    when 'approvers' then v_entity := 'approver'; v_client := new.client_id;
    when 'approver_invites' then v_entity := 'approver_invite'; v_client := new.client_id;
    when 'materials' then v_entity := 'material'; v_client := new.client_id;
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
    elsif v_entity = 'material' then
      v_action := 'material.updated';
      if old.status is distinct from new.status then
        v_meta := v_meta || jsonb_build_object('status_from', old.status, 'status_to', new.status);
      end if;
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

create trigger materials_audit_row after insert or update or delete on public.materials
  for each row execute function app.audit_row_change();
