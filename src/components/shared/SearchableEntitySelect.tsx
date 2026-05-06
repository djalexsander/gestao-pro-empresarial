import { useMemo, useState, type ReactNode } from "react";
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

export function normalizarTexto(s: string | null | undefined): string {
  return (s ?? "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export function normalizarDocumento(s: string | null | undefined): string {
  return (s ?? "").toString().replace(/\D+/g, "");
}

type ExtraOption = { value: string; label: string };

type Props<T> = {
  value: string | null | undefined;
  items: T[];
  getId: (item: T) => string;
  /** texto principal do item (label) */
  getPrimary: (item: T) => string;
  /** texto secundário (ex.: documento, sku, etc.) — opcional */
  getSecondary?: (item: T) => string | null | undefined;
  /** campos textuais para busca por texto (nome, fantasia, e-mail...) */
  getTextFields: (item: T) => Array<string | null | undefined>;
  /** campos numéricos / códigos para busca por dígitos (CPF/CNPJ, telefone, código) */
  getDigitFields?: (item: T) => Array<string | null | undefined>;
  onChange: (id: string, item: T | null) => void;
  /** opções extras prepended (ex.: "Todos", "Sem fornecedor") — value especial */
  extraOptions?: ExtraOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  renderItem?: (item: T) => ReactNode;
};

type Scored<T> = { item: T; score: number };

export function SearchableEntitySelect<T>({
  value,
  items,
  getId,
  getPrimary,
  getSecondary,
  getTextFields,
  getDigitFields,
  onChange,
  extraOptions = [],
  placeholder = "Selecionar...",
  searchPlaceholder = "Buscar...",
  emptyText = "Nenhum resultado.",
  disabled,
  className,
  renderItem,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const lista = useMemo(() => {
    const q = normalizarTexto(query);
    const qDigits = normalizarDocumento(query);
    if (!q && !qDigits) {
      return items
        .slice()
        .sort((a, b) => getPrimary(a).localeCompare(getPrimary(b), "pt-BR"))
        .slice(0, 200);
    }
    const scored: Scored<T>[] = [];
    for (const item of items) {
      let score: number | null = null;
      const primary = normalizarTexto(getPrimary(item));
      if (q) {
        if (primary.startsWith(q)) score = 0;
        else if (primary.includes(q)) score = 1;
        else {
          const textos = getTextFields(item)
            .filter(Boolean)
            .map((s) => normalizarTexto(s as string));
          if (textos.some((t) => t.startsWith(q))) score = 2;
          else if (textos.some((t) => t.includes(q))) score = 3;
        }
      }
      if (score === null && qDigits && getDigitFields) {
        const digits = getDigitFields(item)
          .filter(Boolean)
          .map((s) => normalizarDocumento(s as string))
          .filter((d) => d.length > 0);
        if (digits.some((d) => d.startsWith(qDigits))) score = 4;
        else if (digits.some((d) => d.includes(qDigits))) score = 5;
      }
      if (score !== null) scored.push({ item, score });
    }
    scored.sort(
      (a, b) =>
        a.score - b.score ||
        getPrimary(a.item).localeCompare(getPrimary(b.item), "pt-BR"),
    );
    return scored.slice(0, 100).map((x) => x.item);
  }, [items, query, getPrimary, getTextFields, getDigitFields]);

  const selecionado = useMemo(() => {
    if (!value) return null;
    const extra = extraOptions.find((e) => e.value === value);
    if (extra) return { kind: "extra" as const, label: extra.label };
    const item = items.find((i) => getId(i) === value);
    if (item) return { kind: "item" as const, item };
    return null;
  }, [items, value, extraOptions, getId]);

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
            {selecionado
              ? selecionado.kind === "extra"
                ? selecionado.label
                : getPrimary(selecionado.item)
              : placeholder}
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
              placeholder={searchPlaceholder}
              className="h-10 border-0 focus:ring-0"
            />
          </div>
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {extraOptions.length > 0 && (
              <CommandGroup>
                {extraOptions.map((opt) => (
                  <CommandItem
                    key={opt.value}
                    value={opt.value}
                    onSelect={() => {
                      onChange(opt.value, null);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === opt.value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {opt.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup>
              {lista.map((item) => {
                const id = getId(item);
                const sec = getSecondary?.(item);
                return (
                  <CommandItem
                    key={id}
                    value={id}
                    onSelect={() => {
                      onChange(id, item);
                      setOpen(false);
                      setQuery("");
                    }}
                    className="flex items-start gap-2"
                  >
                    <Check
                      className={cn(
                        "mt-0.5 h-4 w-4 shrink-0",
                        value === id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {renderItem ? (
                      renderItem(item)
                    ) : (
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {getPrimary(item)}
                        </div>
                        {sec ? (
                          <div className="truncate text-xs text-muted-foreground">
                            {sec}
                          </div>
                        ) : null}
                      </div>
                    )}
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
