import { Construction } from "lucide-react";

/**
 * Aviso provisório do Módulo 2: a autenticação já é real, mas as telas ainda leem os dados
 * fictícios (src/lib/mock). Sai no Módulo 3/4, quando o painel e o portal passarem a consultar
 * o banco. Enquanto isso, NÃO cadastre clientes reais.
 */
export function InterimDataNotice() {
  return (
    <p
      role="note"
      className="mb-6 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning"
    >
      <Construction className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        Login real ativo. Os materiais exibidos ainda são de demonstração: a ligação com o banco de dados
        chega no próximo módulo.
      </span>
    </p>
  );
}
