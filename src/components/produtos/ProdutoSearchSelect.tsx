import { useProdutos } from "@/hooks/useProdutos";
import type { ProdutoComCategoria } from "@/integrations/data";
import { SearchableEntitySelect } from "@/components/shared/SearchableEntitySelect";

export type ProdutoSearchOption = ProdutoComCategoria;

type Props = {
  value: string | null | undefined;
  onChange: (produtoId: string, produto: ProdutoSearchOption | null) => void;
  produtos?: ProdutoSearchOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  filter?: (p: ProdutoSearchOption) => boolean;
  extraOptions?: { value: string; label: string }[];
};

export function ProdutoSearchSelect({
  value,
  onChange,
  produtos: produtosProp,
  placeholder = "Selecionar produto...",
  disabled,
  className,
  filter,
  extraOptions,
}: Props) {
  const { data: produtosHook = [] } = useProdutos();
  const base = produtosProp ?? produtosHook;
  const lista = base.filter(filter ?? ((p) => p.status === "ativo"));

  return (
    <SearchableEntitySelect<ProdutoSearchOption>
      value={value}
      items={lista}
      getId={(p) => p.id}
      getPrimary={(p) => p.nome}
      getSecondary={(p) => {
        const codigo = p.codigo_barras || p.codigo_interno || p.qr_code || null;
        const parts = [`SKU ${p.sku}`];
        if (codigo) parts.push(codigo);
        if (p.categoria?.nome) parts.push(p.categoria.nome);
        return parts.join(" · ");
      }}
      getTextFields={(p) => [p.nome, p.sku, p.codigo_interno]}
      getDigitFields={(p) => [p.codigo_barras, p.qr_code, p.codigo_interno, p.sku]}
      onChange={onChange}
      placeholder={placeholder}
      searchPlaceholder="Buscar por nome, SKU, código ou código de barras..."
      emptyText="Nenhum produto encontrado."
      disabled={disabled}
      className={className}
      extraOptions={extraOptions}
    />
  );
}
