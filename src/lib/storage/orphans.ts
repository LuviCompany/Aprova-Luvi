/**
 * Limpeza SEGURA de arquivos órfãos do bucket privado `materials`. Funções PURAS (sem rede): o script
 * `scripts/cleanup-storage-orphans.mjs` lista o storage e o banco e entrega os dados aqui.
 *
 * Órfão = objeto no storage que NENHUM registro de `material_files` aponta e que é antigo o bastante para não ser um envio em
 * andamento (o arquivo sobe antes de a linha ser gravada). Só entra no plano de exclusão o que segue o padrão do app
 * (`<uuid do cliente>/<uuid do material>/…`); qualquer outra coisa só é RELATADA, nunca apagada. Linhas do banco sem objeto
 * também só são relatadas: o histórico de versões é imutável e nunca é tocado por esta limpeza.
 */

export interface StorageObject {
  /** Caminho completo no bucket. */
  name: string;
  /** ISO 8601 de criação (ou, na falta, de atualização). */
  createdAt: string | null;
  size?: number | null;
}

export interface OrphanPlan {
  /** Objetos que podem ser apagados (padrão do app, sem registro, mais antigos que a carência). */
  deletable: StorageObject[];
  /** Sem registro, mas recentes: podem ser envios em andamento. Ficam. */
  recent: StorageObject[];
  /** Fora do padrão `<cliente>/<material>/…`: relatados, nunca apagados. */
  unexpected: StorageObject[];
  /** Objetos que têm registro: ficam. */
  kept: number;
  /** Registros de `material_files` sem objeto no storage (só relatório). */
  missing: string[];
}

export const MIN_GRACE_HOURS = 1;
export const DEFAULT_GRACE_HOURS = 24;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const APP_PATH = new RegExp(`^${UUID}/${UUID}/[^/]+(/[^/]+)*$`, "i");

export const isAppPath = (name: string): boolean => APP_PATH.test(name);

export function planOrphans(input: {
  objects: StorageObject[];
  filePaths: string[];
  now: number;
  graceHours?: number;
}): OrphanPlan {
  const grace = Math.max(input.graceHours ?? DEFAULT_GRACE_HOURS, MIN_GRACE_HOURS) * 3_600_000;
  const referenced = new Set(input.filePaths);
  const present = new Set(input.objects.map((o) => o.name));

  const plan: OrphanPlan = { deletable: [], recent: [], unexpected: [], kept: 0, missing: [] };
  for (const object of input.objects) {
    if (referenced.has(object.name)) {
      plan.kept += 1;
      continue;
    }
    if (!isAppPath(object.name)) {
      plan.unexpected.push(object);
      continue;
    }
    const created = object.createdAt ? Date.parse(object.createdAt) : NaN;
    // Sem data confiável: trata como recente (na dúvida, não apaga).
    if (Number.isNaN(created) || input.now - created < grace) plan.recent.push(object);
    else plan.deletable.push(object);
  }
  plan.missing = input.filePaths.filter((path) => !present.has(path));
  return plan;
}

/** Recusas que valem ANTES de apagar qualquer coisa. Devolve a lista de motivos (vazia = pode seguir). */
export function deletionBlockers(input: {
  plan: OrphanPlan;
  fileRowCount: number;
  objectCount: number;
  maxDelete: number;
  allowEmptyDatabase?: boolean;
}): string[] {
  const reasons: string[] = [];
  // Banco sem nenhum arquivo registrado mas com objetos no storage: provavelmente a consulta falhou ou é outro projeto.
  if (input.fileRowCount === 0 && input.objectCount > 0 && !input.allowEmptyDatabase) {
    reasons.push("O banco não tem nenhum arquivo registrado, mas o storage tem objetos: parece o projeto errado ou uma consulta que falhou. Nada será apagado.");
  }
  if (input.plan.deletable.length > input.maxDelete) {
    reasons.push(`O plano apagaria ${input.plan.deletable.length} objetos, acima do limite de ${input.maxDelete}. Confira o relatório ou aumente --max-delete conscientemente.`);
  }
  return reasons;
}
