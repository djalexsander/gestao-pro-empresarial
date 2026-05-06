import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useProdutos } from "@/hooks/useProdutos";
import type { ProdutoComCategoria } from "@/integrations/data";

export type ProdutoSearchOption = ProdutoComCategoria;

type Props = {
  value: string | null | undefined;
  onChange: (produtoId: string, produto: ProdutoSearchOption) => void;
  produtos?: ProdutoSearchOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** filtro custom (ex.: somente ativos). default: status === 'ativo' */
  filter?: (p: ProdutoSearchOption) => boolean;
};

function normalizar(s: string | null | undefined): string {
  return (s ?? "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

type Scored = { p: ProdutoSearchOption; score: number };

/**
 * Score (menor = melhor):
 *  0  nome começa com query
 *  1  nome contém query
 *  2  match em sku/codigo_interno/codigo_barras/qr_code (começa/igual)
 *  3  match em sku/codigo/qr (contém)
 */
function scoreProduto(p: ProdutoSearchOption, q: string): number | null {
  const nome = normalizar(p.nome);
  if (nome.startsWith(q)) return 0;
  if (nome.includes(q)) return 1;
  const codes = [p.sku, p.codigo_interno, p.codigo_barras, p.qr_code]
    .filter(Boolean)
    .map((c) => normalizar(c as string));
  if (codes.some((c) => c.startsWith(q) || c === q)) return 2;
  if (codes.some((c) => c.includes(q))) return 3;
  return null;
}

export function ProdutoSearchSelect({
  value,
  onChange,
  produtos: produtosProp,
  placeholder = "Selecionar produto...",
  disabled,
  className,
  filter,
}: Props) {
  const { data: produtosHook = [] } = useProdutos();
  const produtos = produtosProp ?? produtosHook;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const lista = useMemo(() => {
    const base = produtos.filter(filter ?? ((p) => p.status === "ativo"));
    const q = normalizar(query);
    if (!q) {
      return base
        .slice()
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
        .slice(0, 200);
    }
    const scored: Scored[] = [];
    for (const p of base) {
      const s = scoreProduto(p, q);
      if (s !== null) scored.push({ p, score: s });
    }
    scored.sort(
      (a, b) => a.score - b.score || a.p.nome.localeCompare(b.p.nome, "pt-BR"),
    );
    return scored.slice(0, 100).map((x) => x.p);
  }, [produtos, query, filter]);

  const selecionado = useMemo(
    () => produtos.find((p) => p.id === value) ?? null,
    [produtos, value],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "h-9 w-full justify-between font-normal",
            !selecionado && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate text-left">
            {selecionado ? (
              <>
                {selecionado.nome}{" "}
                <span className="text-muted-foreground">({selecionado.sku})</span>
              </>
            ) : (
              placeholder
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(28rem,calc(100vw-2rem))] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Buscar por nome, SKU, código ou código de barras..."
              className="h-10 border-0 focus:ring-0"
            />
          </div>
          <CommandList>
            <CommandEmpty>Nenhum produto encontrado.</CommandEmpty>
            <CommandGroup>
              {lista.map((p) => {
                const codigo =
                  p.codigo_barras || p.codigo_interno || p.qr_code || null;
                return (
                  <CommandItem
                    key={p.id}
                    value={p.id}
                    onSelect={() => {
                      onChange(p.id, p);
                      setOpen(false);
                      setQuery("");
                    }}
                    className="flex items-start gap-2"
                  >
                    <Check
                      className={cn(
                        "mt-0.5 h-4 w-4 shrink-0",
                        value === p.id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{p.nome}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        SKU {p.sku}
                        {codigo ? ` · ${codigo}` : ""}
                        {p.categoria_nome ? ` · ${p.categoria_nome}` : ""}
                      </div>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
