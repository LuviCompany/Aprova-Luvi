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

/** Fallback das áreas autenticadas enquanto a sessão é verificada no servidor. */
export function ShellSkeleton() {
  return (
    <div role="status" aria-label="Carregando" className="min-h-screen p-6">
      <Skeleton className="mb-6 h-10 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
