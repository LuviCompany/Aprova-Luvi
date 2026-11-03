import Link from "next/link";
import type { ReactNode } from "react";
import { Ban, Clock, Home, Lock, ShieldX } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** Moldura da página pública do link rápido (sem menu do painel). */
export function LinkFrame({ children }: { children: ReactNode }) {
  return (
    <div className="luvi-glow flex min-h-screen flex-col overflow-hidden">
      <header className="flex h-16 items-center justify-center border-b border-white/10">
        <Logo size="sm" />
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>
      <div className="flex justify-center px-4 pb-4">
        <Button variant="outline" render={<Link href="/" />}>
          <Home data-icon="inline-start" /> Voltar ao início
        </Button>
      </div>
      <footer className="py-6 text-center text-xs text-muted-foreground">Aprova Luvi · Luvi Company</footer>
    </div>
  );
}

export type LinkProblemKind = "invalid" | "revoked" | "expired" | "used" | "closed" | "unavailable";

const PROBLEM: Record<LinkProblemKind, { icon: typeof Clock; tone: string; title: string; text: string }> = {
  // Token desconhecido: responde igual a "não encontrado", sem revelar se o token já existiu.
  invalid: {
    icon: ShieldX,
    tone: "text-destructive",
    title: "Link inválido",
    text: "Não encontramos este link de aprovação. Confira o endereço ou fale com a equipe da Luvi.",
  },
  revoked: {
    icon: Ban,
    tone: "text-warning",
    title: "Link revogado",
    text: "Este link foi cancelado pela equipe da Luvi. Peça um novo link, se precisar.",
  },
  expired: {
    icon: Clock,
    tone: "text-warning",
    title: "Link expirado",
    text: "O prazo deste link terminou. Peça à equipe da Luvi um novo link de aprovação.",
  },
  used: {
    icon: Lock,
    tone: "text-warning",
    title: "Link já utilizado",
    text: "Este material já foi avaliado por este link. Por segurança, cada link só pode ser usado uma vez.",
  },
  closed: {
    icon: Lock,
    tone: "text-warning",
    title: "Material não está mais em aprovação",
    text: "Esta solicitação já foi respondida, cancelada ou substituída por uma nova versão. Fale com a equipe da Luvi se precisar de um novo link.",
  },
  unavailable: {
    icon: ShieldX,
    tone: "text-warning",
    title: "Aprovação por link indisponível",
    text: "Este ambiente ainda não está configurado para aprovação por link. Fale com a equipe da Luvi.",
  },
};

export function LinkProblemCard({ kind }: { kind: LinkProblemKind }) {
  const { icon: Icon, tone, title, text } = PROBLEM[kind];
  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="flex flex-col items-center gap-3 py-6 text-center">
        <Icon className={`size-10 ${tone}`} aria-hidden />
        <h1 className="font-heading text-xl font-bold text-white">{title}</h1>
        <p className="text-sm text-muted-foreground">{text}</p>
      </CardContent>
    </Card>
  );
}
