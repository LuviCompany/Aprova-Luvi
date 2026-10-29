import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="luvi-glow flex min-h-screen flex-col items-center justify-center gap-6 overflow-hidden px-4 text-center">
      <Logo size="lg" />
      <div>
        <h1 className="font-heading text-3xl font-bold text-white">Página não encontrada</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          O endereço não existe ou você não tem acesso a este conteúdo.
        </p>
      </div>
      <Button size="lg" render={<Link href="/login" />}>
        Ir para o início
      </Button>
    </main>
  );
}
