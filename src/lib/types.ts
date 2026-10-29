export type MaterialType = "imagem" | "carrossel" | "video" | "pdf";
export type MaterialStatus = "rascunho" | "aguardando" | "alteracao" | "aprovado";
export type ProjectStatus = "ativo" | "pausado" | "concluido";
export type LinkState = "valido" | "expirado" | "revogado" | "utilizado";

export interface Approver {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface Client {
  id: string;
  name: string;
  segment: string;
  initials: string;
  approvers: Approver[];
}

export interface Project {
  id: string;
  clientId: string;
  name: string;
  description: string;
  status: ProjectStatus;
  dueDate: string;
}

export interface MaterialVersion {
  number: number;
  createdAt: string;
  author: string;
  note: string;
}

export interface Material {
  id: string;
  projectId: string;
  clientId: string;
  title: string;
  type: MaterialType;
  status: MaterialStatus;
  channel: string;
  /** Quantidade de slides (carrossel) ou páginas (PDF). */
  slides: number;
  versions: MaterialVersion[];
  submittedAt: string;
  dueDate: string;
}

export interface Comment {
  id: string;
  materialId: string;
  /** Slide comentado (1-based) ou null para comentário geral do material. */
  slide: number | null;
  author: string;
  authorRole: "luvi" | "cliente";
  body: string;
  createdAt: string;
}

export interface Decision {
  id: string;
  materialId: string;
  version: number;
  decision: "aprovado" | "alteracao";
  by: string;
  via: "portal" | "link";
  at: string;
  note?: string;
}

export interface ApprovalLink {
  token: string;
  materialId: string;
  approverId: string;
  expiresAt: string;
  revokedAt?: string;
  usedAt?: string;
}

export interface TeamUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "designer" | "atendimento";
  lastAccess: string;
}
