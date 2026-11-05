"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Falha ao carregar uma tela do portal. Mostra um aviso claro, dentro do menu do portal, com "Tentar de novo". O texto
 * não promete que foi "só a conexão": o problema também pode ser da própria tela; por isso mostra um código de
 * referência (o `digest` do Next), que aparece no log do servidor e permite achar a causa sem expor detalhes ao cliente.
 */
export default function PortalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-sm">
      <p className="flex items-center gap-2 font-semibold text-destructive">
        <AlertTriangle className="size-4" aria-hidden /> Não foi possível carregar esta tela.
      </p>
      <p className="text-muted-foreground">
        Pode ser uma falha momentânea de conexão ou um problema nesta tela. Nada foi alterado. Se continuar, avise a equipe da
        Luvi{error.digest ? <> informando o código <code data-testid="error-digest" className="rounded bg-black/30 px-1.5 py-0.5 text-foreground">{error.digest}</code></> : null}.
      </p>
      <Button variant="outline" onClick={reset}>
        Tentar de novo
      </Button>
    </div>
  );
}
