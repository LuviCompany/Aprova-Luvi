-- Aprova Luvi — Módulo 4, migration D3: privacidade dos aprovadores no portal.
--
-- Problema: a política approvers_select_portal deixava QUALQUER aprovador de um cliente ler TODAS as linhas de
-- approvers desse cliente: nome, e-mail, cargo e o id do login (profile_id) dos colegas. O portal não precisa
-- disso (só lê o vínculo do próprio aprovador), e o app mostra os colegas apenas como "Outro aprovador".
--
-- Correção mínima: o aprovador lê SOMENTE a(s) própria(s) linha(s) — uma por empresa em que ele aprova — e continua
-- restrito a vínculos ativos, de cliente e perfil ativos (app.my_client_ids). A equipe não muda (approvers_select_staff).
-- As funções SECURITY DEFINER (app.my_client_ids, app.my_approver_id) não dependem desta política; comentários,
-- decisões e solicitações seguem como estavam. Nenhum dado é alterado.
drop policy approvers_select_portal on public.approvers;
create policy approvers_select_portal on public.approvers
  for select to authenticated
  using (profile_id = (select auth.uid()) and client_id in (select app.my_client_ids()));
