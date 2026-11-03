-- Aprova Luvi — Módulo 3, etapas C e D, migration C1/2: regras dos arquivos e ordenação de slides.
--
-- 1) Gatilho de validação em material_files (vale para todos, inclusive o service_role):
--    - o arquivo só entra na versão MAIS RECENTE e com o material em rascunho;
--    - o caminho no storage fica sob {client_id}/{material_id}/ (isolamento por cliente E por material);
--    - o tipo do arquivo combina com o tipo do material: imagem, vídeo e PDF têm UM arquivo (posição 1);
--      carrossel tem de 1 a 10 slides, cada um imagem ou vídeo.
--    Limites de tamanho e de tipo MIME já existem nas CHECKs da tabela e no bucket (20 MB imagem,
--    50 MB vídeo e PDF).
-- 2) public.reorder_version_files(version, ordem): reordena os slides de uma versão ainda não enviada, de
--    forma atômica (a unicidade de posição impede trocas por UPDATE simples, e o app não tem UPDATE na
--    tabela). Exige a lista COMPLETA dos arquivos da versão, sem repetir.

create function app.material_files_validate() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.material_type;
  v_status public.material_status;
  v_number integer;
  v_latest integer;
begin
  -- Defesa em profundidade (o gatilho é AFTER, depois da RLS): auth.uid() nulo = servidor de confiança.
  if auth.uid() is not null and not app.staff_can_access(new.client_id) then
    raise exception 'new row violates row-level security policy for table "%"', tg_table_name
      using errcode = '42501';
  end if;
  select m.type, m.status into v_type, v_status
  from public.materials m where m.id = new.material_id and m.client_id = new.client_id;
  if not found then
    raise exception 'material inválido para este arquivo';
  end if;
  if v_status <> 'rascunho' then
    raise exception 'material fora de rascunho: inicie uma revisão para trocar os arquivos'
      using errcode = '23514';
  end if;
  select v.number into v_number from public.material_versions v
    where v.id = new.version_id and v.material_id = new.material_id;
  select max(v.number) into v_latest from public.material_versions v where v.material_id = new.material_id;
  if v_number is distinct from v_latest then
    raise exception 'só a versão mais recente aceita arquivos' using errcode = '23514';
  end if;
  if new.storage_path not like new.client_id::text || '/' || new.material_id::text || '/%' then
    raise exception 'caminho do arquivo fora da pasta do material' using errcode = '23514';
  end if;
  if not (
    (v_type = 'imagem' and new.kind = 'imagem' and new.slide_position = 1)
    or (v_type = 'video' and new.kind = 'video' and new.slide_position = 1)
    or (v_type = 'pdf' and new.kind = 'pdf' and new.slide_position = 1)
    or (v_type = 'carrossel' and new.kind in ('imagem', 'video') and new.slide_position between 1 and 10)
  ) then
    raise exception 'arquivo incompatível com o tipo do material (% / % / posição %)', v_type, new.kind, new.slide_position
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function app.material_files_validate() from public, anon, authenticated, service_role;

-- AFTER INSERT: roda depois das CHECKs, das chaves estrangeiras e da RLS (as mensagens delas continuam as originais).
create trigger material_files_validate after insert on public.material_files
  for each row execute function app.material_files_validate();

create function public.reorder_version_files(p_version_id uuid, p_order uuid[]) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client uuid;
  v_material uuid;
  v_number integer;
  v_latest integer;
  v_count integer;
begin
  select v.client_id, v.material_id, v.number into v_client, v_material, v_number
  from public.material_versions v where v.id = p_version_id;
  if v_client is null or auth.uid() is null or not app.staff_can_access(v_client) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if app.version_was_sent(p_version_id) then
    raise exception 'versão já enviada para aprovação: a ordem não muda' using errcode = '23514';
  end if;
  select max(v.number) into v_latest from public.material_versions v where v.material_id = v_material;
  if v_number <> v_latest then
    raise exception 'só a versão mais recente pode ser reordenada' using errcode = '23514';
  end if;
  select count(*) into v_count from public.material_files f where f.version_id = p_version_id;
  if coalesce(array_length(p_order, 1), 0) <> v_count
     or (select count(distinct x) from unnest(p_order) as x) <> v_count
     or exists (
       select 1 from unnest(p_order) as x
       where not exists (select 1 from public.material_files f where f.id = x and f.version_id = p_version_id)
     ) then
    raise exception 'a ordem precisa listar todos os arquivos da versão, sem repetir' using errcode = '22023';
  end if;
  -- Duas fases: afasta as posições atuais para não colidir com a unicidade e aplica a nova ordem.
  update public.material_files set slide_position = slide_position + 1000 where version_id = p_version_id;
  update public.material_files f set slide_position = o.ord::integer
  from unnest(p_order) with ordinality as o(id, ord)
  where f.id = o.id and f.version_id = p_version_id;
end;
$$;
revoke execute on function public.reorder_version_files(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_version_files(uuid, uuid[]) to authenticated;
