#!/usr/bin/env node
/**
 * Cria a organização "Luvi Company" e o PRIMEIRO administrador, por convite por e-mail.
 * Roda uma única vez, na sua máquina, contra o projeto Supabase novo.
 *
 *   SUPABASE_URL=https://xxxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   NEXT_PUBLIC_APP_URL=https://aprova.luvicompany.com.br \
 *   node scripts/bootstrap-admin.mjs --email voce@luvicompany.com.br --name "Seu Nome"
 *
 * Segurança: a chave de serviço vem só do ambiente (nunca de argumento nem de arquivo
 * versionado); o script se recusa a rodar se já existir qualquer perfil; nenhuma senha é
 * criada ou exibida (o convidado define a própria no link do e-mail).
 *
 * ATENÇÃO: este script ainda NÃO foi executado contra um projeto Supabase real.
 */
import { createClient } from "@supabase/supabase-js";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, arg, i, all) => {
    if (arg.startsWith("--")) acc.push([arg.slice(2), all[i + 1]]);
    return acc;
  }, []),
);

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const email = String(args.email ?? "").trim().toLowerCase();
const name = String(args.name ?? "").trim();

if (!url || !serviceKey) fail("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.");
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Informe --email com um e-mail válido.");
if (name.length < 2) fail('Informe --name "Nome Completo".');

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const { count, error: countError } = await admin.from("profiles").select("id", { count: "exact", head: true });
if (countError) fail(`Não foi possível consultar profiles (as migrations foram aplicadas?): ${countError.message}`);
if (count && count > 0) fail("Já existem perfis cadastrados. O bootstrap só roda em um banco vazio.");

let { data: org } = await admin.from("organizations").select("id").eq("slug", "luvi-company").maybeSingle();
if (!org) {
  const created = await admin
    .from("organizations")
    .insert({ name: "Luvi Company", slug: "luvi-company" })
    .select("id")
    .single();
  if (created.error) fail(`Falha ao criar a organização: ${created.error.message}`);
  org = created.data;
}

const invited = await admin.auth.admin.inviteUserByEmail(email, {
  redirectTo: `${appUrl}/auth/confirm?next=/redefinir-senha`,
  data: { full_name: name },
});
if (invited.error) fail(`Falha ao convidar o usuário: ${invited.error.message}`);

const profile = await admin.from("profiles").insert({
  id: invited.data.user.id,
  organization_id: org.id,
  full_name: name,
  email,
  role: "admin",
});
if (profile.error) {
  await admin.auth.admin.deleteUser(invited.data.user.id); // não deixa conta órfã sem perfil
  fail(`Falha ao criar o perfil: ${profile.error.message}`);
}

console.log(`Administrador convidado: ${email}. Peça para abrir o e-mail e criar a senha.`);

function fail(message) {
  console.error(`Erro: ${message}`);
  process.exit(1);
}
