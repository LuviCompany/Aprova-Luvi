import { demoProjects } from "@/lib/clients/demo";
import { clients as mockClients } from "@/lib/mock/data";
import type { ClientDetail } from "./queries";
import { accessStatus } from "./schema";

/** Detalhe de cliente do MODO DEMONSTRAÇÃO (dados fictícios de src/lib/mock), somente leitura. */
export function demoClientDetail(clientId: string): ClientDetail | null {
  const client = mockClients.find((c) => c.id === clientId);
  if (!client) return null;
  return {
    client: { id: client.id, name: client.name, segment: client.segment, initials: client.initials, active: true },
    approvers: client.approvers.map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      jobTitle: a.role,
      active: true,
      hasLogin: false,
      access: accessStatus(false, null),
      inviteId: null,
      alsoApprovesFor: [],
    })),
    linkCandidates: [],
    projects: demoProjects({ q: "", status: "todos", clientId }),
  };
}
