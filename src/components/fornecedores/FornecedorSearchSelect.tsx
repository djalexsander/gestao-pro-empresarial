import { useFornecedores, type Fornecedor } from "@/hooks/useFornecedores";
import { SearchableEntitySelect } from "@/components/shared/SearchableEntitySelect";

type Props = {
  value: string | null | undefined;
  onChange: (id: string, fornecedor: Fornecedor | null) => void;
  fornecedores?: Fornecedor[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  extraOptions?: { value: string; label: string }[];
  filter?: (f: Fornecedor) => boolean;
};

export function FornecedorSearchSelect({
  value,
  onChange,
  fornecedores: fornecedoresProp,
  placeholder = "Selecionar fornecedor...",
  disabled,
  className,
  extraOptions,
  filter,
}: Props) {
  const { data: fornecedoresHook = [] } = useFornecedores();
  const base = fornecedoresProp ?? fornecedoresHook;
  const lista = filter ? base.filter(filter) : base.filter((f) => f.status === "ativo");

  return (
    <SearchableEntitySelect<Fornecedor>
      value={value}
      items={lista}
      getId={(f) => f.id}
      getPrimary={(f) => f.nome_fantasia || f.razao_social}
      getSecondary={(f) => {
        const parts: string[] = [];
        if (f.nome_fantasia && f.razao_social) parts.push(f.razao_social);
        if (f.documento) parts.push(f.documento);
        if (f.telefone) parts.push(f.telefone);
        return parts.join(" · ") || null;
      }}
      getTextFields={(f) => [f.razao_social, f.nome_fantasia, f.email, f.contato_nome]}
      getDigitFields={(f) => [f.documento, f.telefone]}
      onChange={onChange}
      extraOptions={extraOptions}
      placeholder={placeholder}
      searchPlaceholder="Buscar por nome, CNPJ, telefone, e-mail..."
      emptyText="Nenhum fornecedor encontrado."
      disabled={disabled}
      className={className}
    />
  );
}
