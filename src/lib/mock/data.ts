import type {
  ApprovalLink,
  Client,
  Comment,
  Decision,
  Material,
  Project,
  TeamUser,
} from "@/lib/types";

/**
 * Dados fictícios da Fase 1. Nenhum cliente, e-mail ou arquivo aqui é real.
 * A data de referência é fixa para manter telas e testes determinísticos.
 */
export const NOW = "2026-10-28T12:00:00-03:00";

export const clients: Client[] = [
  {
    id: "c1",
    name: "Casa Aurora Móveis",
    segment: "Varejo / Móveis",
    initials: "CA",
    approvers: [
      { id: "a1", name: "Marina Prado", email: "marina@casaaurora.example", role: "Marketing" },
      { id: "a2", name: "Paulo Aurora", email: "paulo@casaaurora.example", role: "Diretor" },
    ],
  },
  {
    id: "c2",
    name: "Vita Nutri",
    segment: "Saúde e bem-estar",
    initials: "VN",
    approvers: [
      { id: "a3", name: "Dra. Helena Vita", email: "helena@vitanutri.example", role: "Sócia" },
    ],
  },
  {
    id: "c3",
    name: "Brisa Modas",
    segment: "E-commerce / Moda",
    initials: "BM",
    approvers: [
      { id: "a4", name: "Juliana Brisa", email: "juliana@brisamodas.example", role: "Proprietária" },
    ],
  },
  {
    id: "c4",
    name: "Rota 66 Auto Center",
    segment: "Automotivo",
    initials: "R6",
    approvers: [
      { id: "a5", name: "Rogério Lima", email: "rogerio@rota66.example", role: "Gerente" },
    ],
  },
];

export const projects: Project[] = [
  { id: "p1", clientId: "c1", name: "Campanha Black Friday", description: "Peças de feed, stories e carrosséis para a Black Friday.", status: "ativo", dueDate: "2026-11-10" },
  { id: "p2", clientId: "c1", name: "Institucional 2026", description: "Vídeo institucional e apresentação comercial.", status: "ativo", dueDate: "2026-12-05" },
  { id: "p3", clientId: "c2", name: "Lançamento Programa Detox", description: "Conteúdo de lançamento para Instagram.", status: "ativo", dueDate: "2026-11-03" },
  { id: "p4", clientId: "c3", name: "Coleção Primavera", description: "Fotos e carrosséis da nova coleção.", status: "ativo", dueDate: "2026-11-15" },
  { id: "p5", clientId: "c4", name: "Promoções de Novembro", description: "Artes de ofertas e vídeo de chamada.", status: "pausado", dueDate: "2026-11-20" },
  { id: "p6", clientId: "c3", name: "Catálogo Verão (2025)", description: "Catálogo PDF encerrado.", status: "concluido", dueDate: "2026-02-28" },
];

const v = (number: number, createdAt: string, note: string, author = "Equipe Luvi") => ({
  number,
  createdAt,
  author,
  note,
});

export const materials: Material[] = [
  { id: "m1", projectId: "p1", clientId: "c1", title: "Carrossel — Ofertas da Semana", type: "carrossel", status: "aguardando", channel: "Instagram Feed", slides: 6, submittedAt: "2026-10-27T15:20:00-03:00", dueDate: "2026-10-30", versions: [v(1, "2026-10-24T10:00:00-03:00", "Primeira versão"), v(2, "2026-10-27T15:20:00-03:00", "Ajuste de preços e logo")] },
  { id: "m2", projectId: "p1", clientId: "c1", title: "Story — Contagem regressiva", type: "imagem", status: "aguardando", channel: "Instagram Stories", slides: 1, submittedAt: "2026-10-28T09:05:00-03:00", dueDate: "2026-10-29", versions: [v(1, "2026-10-28T09:05:00-03:00", "Primeira versão")] },
  { id: "m3", projectId: "p1", clientId: "c1", title: "Vídeo — Chamada Black Friday 15s", type: "video", status: "alteracao", channel: "Reels", slides: 1, submittedAt: "2026-10-25T18:40:00-03:00", dueDate: "2026-10-31", versions: [v(1, "2026-10-25T18:40:00-03:00", "Primeira versão")] },
  { id: "m4", projectId: "p2", clientId: "c1", title: "Apresentação comercial (PDF)", type: "pdf", status: "aprovado", channel: "Material de vendas", slides: 12, submittedAt: "2026-10-20T11:00:00-03:00", dueDate: "2026-10-27", versions: [v(1, "2026-10-18T14:00:00-03:00", "Primeira versão"), v(2, "2026-10-20T11:00:00-03:00", "Texto revisado")] },
  { id: "m5", projectId: "p3", clientId: "c2", title: "Carrossel — 5 mitos sobre detox", type: "carrossel", status: "aguardando", channel: "Instagram Feed", slides: 8, submittedAt: "2026-10-26T13:10:00-03:00", dueDate: "2026-10-29", versions: [v(1, "2026-10-26T13:10:00-03:00", "Primeira versão")] },
  { id: "m6", projectId: "p3", clientId: "c2", title: "Arte — Abertura de turma", type: "imagem", status: "aprovado", channel: "Instagram Feed", slides: 1, submittedAt: "2026-10-22T10:00:00-03:00", dueDate: "2026-10-24", versions: [v(1, "2026-10-21T16:00:00-03:00", "Primeira versão"), v(2, "2026-10-22T10:00:00-03:00", "Cor do botão")] },
  { id: "m7", projectId: "p3", clientId: "c2", title: "Vídeo — Depoimento aluna", type: "video", status: "rascunho", channel: "Reels", slides: 1, submittedAt: "2026-10-28T08:00:00-03:00", dueDate: "2026-11-02", versions: [v(1, "2026-10-28T08:00:00-03:00", "Corte inicial")] },
  { id: "m8", projectId: "p4", clientId: "c3", title: "Carrossel — Look da semana", type: "carrossel", status: "alteracao", channel: "Instagram Feed", slides: 5, submittedAt: "2026-10-23T17:30:00-03:00", dueDate: "2026-10-28", versions: [v(1, "2026-10-23T17:30:00-03:00", "Primeira versão")] },
  { id: "m9", projectId: "p4", clientId: "c3", title: "Foto — Vestido floral", type: "imagem", status: "aprovado", channel: "Site / E-commerce", slides: 1, submittedAt: "2026-10-19T09:00:00-03:00", dueDate: "2026-10-21", versions: [v(1, "2026-10-19T09:00:00-03:00", "Primeira versão")] },
  { id: "m10", projectId: "p4", clientId: "c3", title: "Story — Lançamento coleção", type: "imagem", status: "aguardando", channel: "Instagram Stories", slides: 1, submittedAt: "2026-10-28T10:30:00-03:00", dueDate: "2026-10-30", versions: [v(1, "2026-10-28T10:30:00-03:00", "Primeira versão")] },
  { id: "m11", projectId: "p5", clientId: "c4", title: "Vídeo — Troca de óleo promocional", type: "video", status: "aguardando", channel: "Reels", slides: 1, submittedAt: "2026-10-21T12:00:00-03:00", dueDate: "2026-10-25", versions: [v(1, "2026-10-21T12:00:00-03:00", "Primeira versão")] },
  { id: "m12", projectId: "p5", clientId: "c4", title: "Arte — Alinhamento e balanceamento", type: "imagem", status: "aprovado", channel: "Instagram Feed", slides: 1, submittedAt: "2026-10-15T14:00:00-03:00", dueDate: "2026-10-18", versions: [v(1, "2026-10-15T14:00:00-03:00", "Primeira versão")] },
  { id: "m13", projectId: "p6", clientId: "c3", title: "Catálogo Verão 2025 (PDF)", type: "pdf", status: "aprovado", channel: "Catálogo", slides: 24, submittedAt: "2026-02-10T10:00:00-03:00", dueDate: "2026-02-20", versions: [v(1, "2026-02-10T10:00:00-03:00", "Versão final")] },
];

export const comments: Comment[] = [
  { id: "k1", materialId: "m1", slide: 3, author: "Marina Prado", authorRole: "cliente", body: "O preço do sofá está errado: o certo é R$ 2.490.", createdAt: "2026-10-26T09:12:00-03:00" },
  { id: "k2", materialId: "m1", slide: 3, author: "Equipe Luvi", authorRole: "luvi", body: "Corrigido na versão 2.", createdAt: "2026-10-27T15:22:00-03:00" },
  { id: "k3", materialId: "m1", slide: null, author: "Equipe Luvi", authorRole: "luvi", body: "Versão 2 com logo atualizado e preços revisados.", createdAt: "2026-10-27T15:25:00-03:00" },
  { id: "k4", materialId: "m3", slide: null, author: "Paulo Aurora", authorRole: "cliente", body: "A música está muito alta e o texto final some rápido demais.", createdAt: "2026-10-27T11:40:00-03:00" },
  { id: "k5", materialId: "m8", slide: 2, author: "Juliana Brisa", authorRole: "cliente", body: "Trocar a foto do slide 2 por uma com fundo claro.", createdAt: "2026-10-26T16:00:00-03:00" },
  { id: "k6", materialId: "m5", slide: 5, author: "Equipe Luvi", authorRole: "luvi", body: "Slide 5 aguarda confirmação da referência científica.", createdAt: "2026-10-26T13:20:00-03:00" },
];

export const decisions: Decision[] = [
  { id: "d1", materialId: "m4", version: 2, decision: "aprovado", by: "Paulo Aurora", via: "portal", at: "2026-10-22T10:30:00-03:00" },
  { id: "d2", materialId: "m6", version: 2, decision: "aprovado", by: "Dra. Helena Vita", via: "link", at: "2026-10-22T18:05:00-03:00" },
  { id: "d3", materialId: "m6", version: 1, decision: "alteracao", by: "Dra. Helena Vita", via: "link", at: "2026-10-21T17:30:00-03:00", note: "Trocar a cor do botão para laranja." },
  { id: "d4", materialId: "m3", version: 1, decision: "alteracao", by: "Paulo Aurora", via: "portal", at: "2026-10-27T11:40:00-03:00", note: "Ajustar áudio e tempo do texto final." },
  { id: "d5", materialId: "m8", version: 1, decision: "alteracao", by: "Juliana Brisa", via: "portal", at: "2026-10-26T16:00:00-03:00", note: "Trocar a foto do slide 2." },
  { id: "d6", materialId: "m9", version: 1, decision: "aprovado", by: "Juliana Brisa", via: "link", at: "2026-10-20T08:45:00-03:00" },
  { id: "d7", materialId: "m12", version: 1, decision: "aprovado", by: "Rogério Lima", via: "link", at: "2026-10-16T09:20:00-03:00" },
  { id: "d8", materialId: "m13", version: 1, decision: "aprovado", by: "Juliana Brisa", via: "portal", at: "2026-02-12T10:00:00-03:00" },
];

export const approvalLinks: ApprovalLink[] = [
  { token: "demo", materialId: "m1", approverId: "a1", expiresAt: "2026-11-04T23:59:00-03:00" },
  { token: "expirado", materialId: "m11", approverId: "a5", expiresAt: "2026-10-25T23:59:00-03:00" },
  { token: "revogado", materialId: "m5", approverId: "a3", expiresAt: "2026-11-10T23:59:00-03:00", revokedAt: "2026-10-27T10:00:00-03:00" },
  { token: "utilizado", materialId: "m4", approverId: "a2", expiresAt: "2026-11-01T23:59:00-03:00", usedAt: "2026-10-22T10:30:00-03:00" },
];

export const teamUsers: TeamUser[] = [
  { id: "u1", name: "Enzo (Admin)", email: "enzo@luvicompany.example", role: "admin", lastAccess: "2026-10-28T11:50:00-03:00" },
  { id: "u2", name: "Camila Designer", email: "camila@luvicompany.example", role: "designer", lastAccess: "2026-10-28T09:15:00-03:00" },
  { id: "u3", name: "Bruno Atendimento", email: "bruno@luvicompany.example", role: "atendimento", lastAccess: "2026-10-27T17:40:00-03:00" },
];

/** Cliente "logado" no portal da Fase 1. */
export const CURRENT_PORTAL_CLIENT_ID = "c1";
export const CURRENT_PORTAL_APPROVER_ID = "a1";
