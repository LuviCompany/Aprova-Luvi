-- Aprova Luvi — migration 16: privilégios EXPLÍCITOS do service_role nas tabelas do schema public.
--
-- Por quê: desde 30/05/2026 os projetos novos do Supabase NÃO concedem mais privilégios automáticos
-- (anon, authenticated e service_role) em tabelas novas do schema public. O projeto de desenvolvimento,
-- criado antes, deu ALL ao service_role por padrão e escondeu a falta: no projeto de produção o
-- servidor (chave secreta) recebia "permission denied" (42501, HTTP 403) em qualquer tabela.
-- As migrations 1 a 15 concedem as tabelas ao `authenticated` de forma explícita, mas nunca ao service_role.
--
-- O que esta migration faz: deixa o service_role com EXATAMENTE o que o código do servidor usa
-- (src/lib/invites, src/lib/link-approval, scripts/bootstrap-admin, invite-approver, cleanup-storage-orphans e
-- backup-tools), por tabela e, nas escritas, por coluna. Primeiro revoga tudo (estado final igual em qualquer
-- projeto, com o padrão antigo ou o novo), depois concede o mínimo.
--
--   organizations              SELECT; INSERT (name, slug)                        primeiro administrador
--   profiles                   SELECT; INSERT (id, organization_id, full_name,    primeiro administrador e convites;
--                              email, role); DELETE                                DELETE só desfaz um convite que falhou
--   clients                    SELECT                                             convites
--   approvers                  SELECT; UPDATE (profile_id)                        liga o acesso ao aprovador
--   approver_invites           SELECT; UPDATE (status, sent_at, expires_at,       estado do convite
--                              accepted_at)
--   materials, material_versions, material_version_contents, material_files,
--   comments, decisions        SELECT                                             tela de revisão do link rápido e arquivos
--
-- SEM nenhum privilégio direto (continuam só pelas funções SECURITY DEFINER já concedidas): projects,
-- approval_requests, approval_links, approval_verifications, approval_link_sessions e audit_events. Decisões,
-- comentários, versões e auditoria seguem imutáveis (triggers) e o service_role não ganha INSERT/UPDATE/DELETE
-- neles. Sem TRUNCATE, REFERENCES nem TRIGGER em tabela alguma. Não há sequência a conceder (os ids são uuid;
-- audit_events recebe linhas apenas por funções de trigger do dono).
--
-- Não mexe em RLS, políticas, nos privilégios de anon e authenticated, nas funções nem no schema app.
-- O service_role ignora RLS (BYPASSRLS), por isso as políticas não mudam.

revoke all on all tables in schema public from service_role;
revoke all on all sequences in schema public from service_role;

grant select on
  public.organizations,
  public.profiles,
  public.clients,
  public.approvers,
  public.approver_invites,
  public.materials,
  public.material_versions,
  public.material_version_contents,
  public.material_files,
  public.comments,
  public.decisions
to service_role;

grant insert (name, slug) on public.organizations to service_role;
grant insert (id, organization_id, full_name, email, role) on public.profiles to service_role;
grant delete on public.profiles to service_role;
grant update (profile_id) on public.approvers to service_role;
grant update (status, sent_at, expires_at, accepted_at) on public.approver_invites to service_role;
