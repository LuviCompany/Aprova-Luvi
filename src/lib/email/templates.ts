/**
 * Modelos dos e-mails transacionais do Aprova Luvi (texto simples + HTML com estilos em linha, que é o que os clientes
 * de e-mail aceitam). Funções PURAS: recebem os dados já prontos e devolvem assunto, texto e HTML. Todo valor variável
 * é escapado no HTML; links entram só como `href` e como texto visível. Nada daqui vai para log.
 */

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

export const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const BRAND = "#FF3B00";

function layout(title: string, bodyHtml: string, button?: { label: string; href: string }): string {
  const cta = button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(button.href)}" style="background:${BRAND};color:#ffffff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:999px;display:inline-block">${escapeHtml(button.label)}</a></p>`
    : "";
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b"><div style="max-width:520px;margin:0 auto;padding:24px"><div style="background:#ffffff;border-radius:16px;padding:28px"><p style="margin:0 0 16px;font-size:13px;font-weight:700;color:${BRAND};letter-spacing:.04em">APROVA LUVI</p><h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(title)}</h1>${bodyHtml}${cta}</div><p style="font-size:12px;color:#71717a;text-align:center;margin-top:16px">Aprova Luvi · Luvi Company</p></div></body></html>`;
}

/** Convite de acesso ao portal (o aprovador cria a própria senha pelo link). */
export function inviteEmail(input: { name: string; clientName: string; url: string; validityHours: number; resend?: boolean }): EmailContent {
  const intro = input.resend ? "Aqui está um novo link" : "Você foi convidado(a)";
  return {
    subject: input.resend ? "Novo link de acesso ao portal Aprova Luvi" : "Seu acesso ao portal Aprova Luvi",
    text: `Olá, ${input.name}!\n\n${intro} para acessar o portal Aprova Luvi, onde você aprova os materiais da ${input.clientName} criados pela Luvi Company.\n\nCrie a sua senha pelo link abaixo (vale por ${input.validityHours} horas e só pode ser usado uma vez):\n\n${input.url}\n\nSe você não esperava este e-mail, ignore-o: nada será ativado sem o seu clique.`,
    html: layout(
      input.resend ? "Novo link de acesso" : "Seu acesso ao portal",
      `<p>Olá, ${escapeHtml(input.name)}!</p><p>${escapeHtml(intro)} para acessar o portal <strong>Aprova Luvi</strong>, onde você aprova os materiais da <strong>${escapeHtml(input.clientName)}</strong> criados pela Luvi Company.</p><p>O link vale por ${input.validityHours} horas e só pode ser usado uma vez.</p><p style="font-size:13px;color:#52525b">Se o botão não funcionar, copie este endereço no navegador:<br>${escapeHtml(input.url)}</p><p style="font-size:13px;color:#52525b">Se você não esperava este e-mail, ignore-o: nada será ativado sem o seu clique.</p>`,
      { label: "Criar minha senha", href: input.url },
    ),
  };
}

/** Convite para a EQUIPE da Luvi (a pessoa cria a própria senha pelo link). */
export function teamInviteEmail(input: { name: string; roleLabel: string; url: string; validityHours: number; resend?: boolean }): EmailContent {
  const intro = input.resend ? "Aqui está um novo link" : "Você foi convidado(a)";
  return {
    subject: input.resend ? "Novo link de acesso ao painel Aprova Luvi" : "Seu acesso ao painel Aprova Luvi",
    text: `Olá, ${input.name}!

${intro} para acessar o painel do Aprova Luvi como ${input.roleLabel}, na equipe da Luvi Company.

Crie a sua senha pelo link abaixo (vale por ${input.validityHours} horas e só pode ser usado uma vez):

${input.url}

Se você não esperava este e-mail, ignore-o: nada será ativado sem o seu clique.`,
    html: layout(
      input.resend ? "Novo link de acesso" : "Seu acesso ao painel",
      `<p>Olá, ${escapeHtml(input.name)}!</p><p>${escapeHtml(intro)} para acessar o painel do <strong>Aprova Luvi</strong> como <strong>${escapeHtml(input.roleLabel)}</strong>, na equipe da Luvi Company.</p><p>O link vale por ${input.validityHours} horas e só pode ser usado uma vez.</p><p style="font-size:13px;color:#52525b">Se o botão não funcionar, copie este endereço no navegador:<br>${escapeHtml(input.url)}</p><p style="font-size:13px;color:#52525b">Se você não esperava este e-mail, ignore-o: nada será ativado sem o seu clique.</p>`,
      { label: "Criar minha senha", href: input.url },
    ),
  };
}

/** Link rápido de aprovação (sem login). */
export function approvalLinkEmail(input: { name: string; url: string; validityDays: number }): EmailContent {
  return {
    subject: "Material para aprovação · Aprova Luvi",
    text: `Olá, ${input.name}!\n\nHá um material da Luvi Company esperando a sua aprovação.\nAbra o link abaixo (vale por ${input.validityDays} dias):\n\n${input.url}\n\nPor segurança, você receberá um código por e-mail para confirmar que é você.`,
    html: layout(
      "Material para aprovação",
      `<p>Olá, ${escapeHtml(input.name)}!</p><p>Há um material da Luvi Company esperando a sua aprovação. O link vale por ${input.validityDays} dias.</p><p style="font-size:13px;color:#52525b">Por segurança, você receberá um código por e-mail para confirmar que é você.</p><p style="font-size:13px;color:#52525b">Se o botão não funcionar, copie este endereço no navegador:<br>${escapeHtml(input.url)}</p>`,
      { label: "Revisar o material", href: input.url },
    ),
  };
}

/** Código de verificação do link rápido (6 dígitos). */
export function verificationCodeEmail(input: { name: string; code: string; validityMinutes: number }): EmailContent {
  return {
    subject: "Seu código de verificação · Aprova Luvi",
    text: `Olá, ${input.name}!\n\nSeu código de verificação é: ${input.code}\n\nEle vale por ${input.validityMinutes} minutos. Se você não pediu este código, ignore esta mensagem.`,
    html: layout(
      "Seu código de verificação",
      `<p>Olá, ${escapeHtml(input.name)}!</p><p style="font-size:32px;font-weight:700;letter-spacing:.2em;margin:16px 0">${escapeHtml(input.code)}</p><p>Ele vale por ${input.validityMinutes} minutos. Se você não pediu este código, ignore esta mensagem.</p>`,
    ),
  };
}
