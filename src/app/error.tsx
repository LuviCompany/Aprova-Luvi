"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Última barreira: erros que o painel não captura (por exemplo, o serviço de autenticação
 * inalcançável ao abrir uma área protegida). Falha fechada: nada protegido é exibido.
 */
export default function RootError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div role="alert" className="flex max-w-md flex-col items-start gap-3 rounded-2xl border border-white/10 bg-card p-6 text-sm">
        <p className="flex items-center gap-2 font-semibold text-white">
          <AlertTriangle className="size-4 text-warning" aria-hidden /> Algo deu errado.
        </p>
        <p className="text-muted-foreground">
          Não foi possível concluir agora, possivelmente por uma falha momentânea de conexão. Nada foi alterado.
        </p>
        <Button onClick={reset}>Tentar de novo</Button>
      </div>
    </main>
  );
}
