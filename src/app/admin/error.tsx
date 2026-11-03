"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Falha ao carregar uma tela do painel (rede, banco indisponível). Mostra um aviso claro com
 * "Tentar de novo" em vez de uma tela em branco ou de fingir que a sessão acabou.
 */
export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-sm"
    >
      <p className="flex items-center gap-2 font-semibold text-destructive">
        <AlertTriangle className="size-4" aria-hidden /> Não foi possível carregar esta tela.
      </p>
      <p className="text-muted-foreground">
        Pode ser uma falha momentânea de conexão com o servidor de dados. Seus dados não foram alterados.
      </p>
      <Button variant="outline" onClick={reset}>
        Tentar de novo
      </Button>
    </div>
  );
}
