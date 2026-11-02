-- Aprova Luvi — Fase 2, migration 4/4: armazenamento privado de materiais.
--
-- Bucket único e PRIVADO. Convenção de caminho: {client_id}/{material_id}/{version_id}/{arquivo}.
-- Nenhum acesso anônimo: o navegador só obtém arquivos por URL assinada, gerada no servidor
-- depois de checar a permissão do usuário.
--
-- Limite de 50 MB por arquivo: é o teto do plano gratuito do Supabase Storage. Vídeos maiores
-- exigem plano Pro e a revisão dos limites aqui e na tabela material_files.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'materials', 'materials', false, 52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Equipe: lê e envia arquivos dos clientes da própria organização.
create policy materials_objects_select_staff on storage.objects
  for select to authenticated
  using (
    bucket_id = 'materials'
    and app.staff_can_access(app.try_uuid(split_part(name, '/', 1)))
  );

create policy materials_objects_insert_staff on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'materials'
    and app.staff_can_access(app.try_uuid(split_part(name, '/', 1)))
  );

-- Apagar só arquivos que ainda não pertencem a uma versão enviada para aprovação.
create policy materials_objects_delete_staff on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'materials'
    and app.staff_can_access(app.try_uuid(split_part(name, '/', 1)))
    and not exists (
      select 1 from public.material_files f
      where f.storage_path = storage.objects.name and app.version_was_sent(f.version_id)
    )
  );

-- Aprovador (portal): lê apenas arquivos de versões enviadas ao seu cliente.
create policy materials_objects_select_portal on storage.objects
  for select to authenticated
  using (
    bucket_id = 'materials'
    and exists (
      select 1 from public.material_files f
      where f.storage_path = storage.objects.name
        and f.client_id in (select app.my_client_ids())
        and app.version_was_sent(f.version_id)
    )
  );
