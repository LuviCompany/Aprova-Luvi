import Link from "next/link";
import { Search } from "lucide-react";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Option {
  value: string;
  label: string;
}

interface ListFiltersProps {
  /** Rota da listagem; "Limpar" volta para ela sem parâmetros. */
  action: string;
  q: string;
  status: { value: string; options: Option[] };
  /** Filtro opcional por cliente (tela de projetos). */
  client?: { value: string; options: Option[] };
  /** Texto lido por leitores de tela e mostrado abaixo: "3 clientes". */
  summary: string;
}

/** Filtros por URL (GET): funcionam sem JavaScript, podem ser compartilhados e a página só relê o banco. */
export function ListFilters({ action, q, status, client, summary }: ListFiltersProps) {
  const active = !!q || status.value !== status.options[0]?.value || (!!client && client.value !== "");
  return (
    <form
      // Campos não controlados ignoram mudanças de defaultValue: remonta o formulário quando os filtros da URL mudam
      // (por exemplo, ao clicar em "Limpar"), senão os campos continuam mostrando o filtro antigo.
      key={[q, status.value, client?.value ?? ""].join("|")}
      method="get"
      action={action}
      role="search"
      className="mb-6 flex flex-col gap-3"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto] lg:items-end">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filtro-busca">Buscar por nome</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="filtro-busca" name="q" type="search" defaultValue={q} maxLength={80} className="pl-9" />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filtro-status">Status</Label>
          <NativeSelect id="filtro-status" name="status" defaultValue={status.value}>
            {status.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        {client ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filtro-cliente">Cliente</Label>
            <NativeSelect id="filtro-cliente" name="cliente" defaultValue={client.value}>
              {client.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : (
          <div className="hidden lg:block" />
        )}
        <div className="flex items-center gap-2">
          <Button type="submit" variant="secondary">
            Filtrar
          </Button>
          {active && (
            <Link href={action} className="text-sm text-muted-foreground underline underline-offset-4 hover:text-white">
              Limpar
            </Link>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {summary}
      </p>
    </form>
  );
}
