import { Skeleton } from "@/components/ui/skeleton";

/** Fallback de rotas dinâmicas: mantém o cabeçalho da página estável enquanto os dados chegam. */
export function PageSkeleton() {
  return (
    <div role="status" aria-label="Carregando" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="aspect-square w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    </div>
  );
}
