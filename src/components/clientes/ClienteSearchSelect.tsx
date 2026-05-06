import { useClientes, type Cliente } from "@/hooks/useClientes";
import { SearchableEntitySelect } from "@/components/shared/SearchableEntitySelect";

type Props = {
  value: string | null | undefined;
  onChange: (id: string, cliente: Cliente | null) => void;
  clientes?: Cliente[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  extraOptions?: { value: string; label: string }[];
  filter?: (c: Cliente) => boolean;
};

export function ClienteSearchSelect({
  value,
  onChange,
  clientes: clientesProp,
  placeholder = "Selecionar cliente...",
  disabled,
  className,
  extraOptions,
  filter,
}: Props) {
  const { data: clientesHook = [] } = useClientes();
  const base = clientesProp ?? clientesHook;
  const lista = filter ? base.filter(filter) : base.filter((c) => c.status === "ativo");

  return (
    <SearchableEntitySelect<Cliente>
      value={value}
      items={lista}
      getId={(c) => c.id}
      getPrimary={(c) => c.nome}
      getSecondary={(c) => {
        const parts: string[] = [];
        if (c.nome_fantasia) parts.push(c.nome_fantasia);
        if (c.documento) parts.push(c.documento);
        if (c.celular || c.telefone) parts.push((c.celular || c.telefone) as string);
        return parts.join(" · ") || null;
      }}
      getTextFields={(c) => [c.nome, c.nome_fantasia, c.email]}
      getDigitFields={(c) => [c.documento, c.telefone, c.celular]}
      onChange={onChange}
      extraOptions={extraOptions}
      placeholder={placeholder}
      searchPlaceholder="Buscar por nome, CPF/CNPJ, telefone, e-mail..."
      emptyText="Nenhum cliente encontrado."
      disabled={disabled}
      className={className}
    />
  );
}
