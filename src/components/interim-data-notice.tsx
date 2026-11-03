import { Suspense } from "react";
import { connection } from "next/server";
import { Construction } from "lucide-react";
import { isDemoMode } from "@/lib/env";

/**
 * Aviso nas telas que AINDA leem os dados fictícios de src/lib/mock (dashboard, materiais,
 * histórico, usuários). Fora do modo demonstração, sem ele alguém poderia confundir os números
 * de exemplo com dados reais. Cada tela passa a ficar SEM o aviso quando migra para o banco
 * (clientes e projetos já migraram, no Módulo 3 etapa A).
 *
 * O modo é decidido a cada requisição (`connection()`), nunca congelado na build.
 */
export function MockDataNotice({ until = "nas próximas etapas do Módulo 3" }: { until?: string }) {
  return (
    <Suspense fallback={null}>
      <MockDataNoticeContent until={until} />
    </Suspense>
  );
}

async function MockDataNoticeContent({ until }: { until: string }) {
  await connection();
  if (isDemoMode()) return null;
  return (
    <p
      role="note"
      className="mb-6 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning"
    >
      <Construction className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        Esta tela ainda mostra <strong>dados de demonstração</strong>: eles não vêm do seu banco de dados e não
        representam clientes reais. A ligação com o banco chega {until}.
      </span>
    </p>
  );
}
