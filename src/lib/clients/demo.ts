import { clients as mockClients, materials as mockMaterials, projects as mockProjects } from "@/lib/mock/data";
import type { ClientListItem, ClientOption, ProjectListItem } from "./queries";
import type { ClientFilters, ProjectFilters } from "./schema";

/**
 * Clientes e projetos do MODO DEMONSTRAÇÃO (dados fictícios de src/lib/mock), no mesmo formato
 * da leitura real. Fora do modo demonstração esta função nunca é chamada: nada fictício aparece
 * misturado a dados reais.
 */

const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const matches = (name: string, q: string) => !q || fold(name).includes(fold(q));

export function demoClients(filters: ClientFilters): ClientListItem[] {
  return mockClients
    .filter((client) => matches(client.name, filters.q))
    .filter(() => filters.status !== "arquivados") // a demonstração não tem clientes arquivados
    .map((client) => ({
      id: client.id,
      name: client.name,
      segment: client.segment,
      initials: client.initials,
      active: true,
      projectCount: mockProjects.filter((p) => p.clientId === client.id).length,
      pendingCount: mockMaterials.filter((m) => m.clientId === client.id && m.status === "aguardando").length,
      approvers: client.approvers.map((a) => ({
        id: a.id,
        name: a.name,
        email: a.email,
        jobTitle: a.role,
        active: true,
      })),
    }));
}

export function demoClientOptions(): ClientOption[] {
  return mockClients.map((client) => ({ id: client.id, name: client.name, active: true }));
}

export function demoProjects(filters: ProjectFilters): ProjectListItem[] {
  return mockProjects
    .filter((project) => matches(project.name, filters.q))
    .filter((project) => !filters.clientId || project.clientId === filters.clientId)
    .filter((project) => filters.status === "todos" || project.status === filters.status)
    .map((project) => {
      const items = mockMaterials.filter((m) => m.projectId === project.id);
      return {
        id: project.id,
        clientId: project.clientId,
        clientName: mockClients.find((c) => c.id === project.clientId)?.name ?? "—",
        clientActive: true,
        name: project.name,
        description: project.description,
        status: project.status,
        dueDate: project.dueDate,
        materialCount: items.length,
        approvedCount: items.filter((m) => m.status === "aprovado").length,
      };
    });
}
