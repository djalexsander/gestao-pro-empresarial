import { useClientes, type ClienteLite } from "@/hooks/useClientes";
import { SearchableEntitySelect } from "@/components/shared/SearchableEntitySelect";

type Props = {
  value: string | null | undefined;
  onChange: (id: string, cliente: ClienteLite | null) => void;
  clientes?: ClienteLite[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  extraOptions?: { value: string; label: string }[];
};

export function ClienteSearchSelect({
  value,
  onChange,
  clientes: clientesProp,
  placeholder = "Selecionar cliente...",
  disabled,
  className,
  extraOptions,
}: Props) {
  const { data: clientesHook = [] } = useClientes();
  const lista = clientesProp ?? clientesHook;

  return (
    <SearchableEntitySelect<ClienteLite>
      value={value}
      items={lista}
      getId={(c) => c.id}
      getPrimary={(c) => c.nome}
      getSecondary={(c) => {
        const parts: string[] = [];
        if (c.nome_fantasia) parts.push(c.nome_fantasia);
        if (c.documento) parts.push(c.documento);
        return parts.join(" · ") || null;
      }}
      getTextFields={(c) => [c.nome, c.nome_fantasia]}
      getDigitFields={(c) => [c.documento]}
      onChange={onChange}
      extraOptions={extraOptions}
      placeholder={placeholder}
      searchPlaceholder="Buscar por nome, CPF/CNPJ..."
      emptyText="Nenhum cliente encontrado."
      disabled={disabled}
      className={className}
    />
  );
}
