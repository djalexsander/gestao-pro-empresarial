import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Plus, Tag, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useCategorias, useCreateCategoria } from "@/hooks/useProdutos";

interface CategoriaComboboxProps {
  value: string; // categoria_id ou ""
  onChange: (categoriaId: string) => void;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
}

export function CategoriaCombobox({
  value,
  onChange,
  id,
  disabled,
  placeholder = "Selecionar categoria...",
}: CategoriaComboboxProps) {
  const { data: categorias = [], isLoading } = useCategorias();
  const createMut = useCreateCategoria();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = useMemo(
    () => categorias.find((c) => c.id === value) ?? null,
    [categorias, value],
  );

  const queryTrimmed = query.trim();
  const queryLower = queryTrimmed.toLowerCase();

  const filtered = useMemo(() => {
    if (!queryLower) return categorias;
    return categorias.filter((c) => c.nome.toLowerCase().includes(queryLower));
  }, [categorias, queryLower]);

  const exactMatch = useMemo(
    () =>
      queryTrimmed.length > 0 &&
      categorias.some((c) => c.nome.trim().toLowerCase() === queryLower),
    [categorias, queryTrimmed, queryLower],
  );

  const canCreate = queryTrimmed.length >= 2 && !exactMatch;

  async function handleCreate() {
    if (!canCreate || createMut.isPending) return;
    try {
      const nova = await createMut.mutateAsync(queryTrimmed);
      onChange(nova.id);
      setQuery("");
      setOpen(false);
    } catch {
      /* toast já mostrado pelo hook */
    }
  }

  function handleSelect(catId: string) {
    onChange(catId);
    setQuery("");
    setOpen(false);
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange("");
    setQuery("");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal",
            !selected && "text-muted-foreground",
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Tag className="h-3.5 w-3.5 shrink-0 opacity-60" />
            <span className="truncate">
              {selected ? selected.nome : placeholder}
            </span>
          </span>
          <span className="flex items-center gap-1">
            {selected && !disabled && (
              <span
                role="button"
                tabIndex={-1}
                onClick={handleClear}
                className="rounded p-0.5 text-muted-foreground opacity-70 transition-opacity hover:bg-muted hover:opacity-100"
                aria-label="Limpar categoria"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            )}
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Buscar ou criar categoria..."
            value={query}
            onValueChange={setQuery}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canCreate && filtered.length === 0) {
                e.preventDefault();
                handleCreate();
              }
            }}
          />
          <CommandList>
            {isLoading ? (
              <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                Carregando...
              </div>
            ) : (
              <>
                <CommandGroup>
                  <CommandItem
                    value="__none__"
                    onSelect={() => handleSelect("")}
                    className="text-muted-foreground"
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        !value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    Sem categoria
                  </CommandItem>
                </CommandGroup>

                {filtered.length > 0 && (
                  <>
                    <CommandSeparator />
                    <CommandGroup heading="Categorias">
                      {filtered.map((c) => (
                        <CommandItem
                          key={c.id}
                          value={c.id}
                          onSelect={() => handleSelect(c.id)}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              value === c.id ? "opacity-100" : "opacity-0",
                            )}
                          />
                          <Tag className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                          {c.nome}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </>
                )}

                {filtered.length === 0 && !canCreate && (
                  <CommandEmpty>
                    {queryTrimmed.length === 0
                      ? "Nenhuma categoria cadastrada."
                      : queryTrimmed.length < 2
                      ? "Digite ao menos 2 caracteres para criar."
                      : "Categoria já existe."}
                  </CommandEmpty>
                )}

                {canCreate && (
                  <>
                    <CommandSeparator />
                    <CommandGroup>
                      <CommandItem
                        value={`__create__${queryTrimmed}`}
                        onSelect={handleCreate}
                        disabled={createMut.isPending}
                        className="text-primary"
                      >
                        {createMut.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Plus className="mr-2 h-4 w-4" />
                        )}
                        Criar nova categoria:{" "}
                        <span className="ml-1 font-medium">
                          “{queryTrimmed}”
                        </span>
                      </CommandItem>
                    </CommandGroup>
                  </>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
