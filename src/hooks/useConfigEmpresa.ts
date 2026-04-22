import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ConfigEmpresa {
  id: string;
  razao_social: string;
  nome_fantasia: string | null;
  cnpj: string | null;
  inscricao_estadual: string | null;
  inscricao_municipal: string | null;
  telefone: string | null;
  email: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
  logo_url: string | null;
}

/**
 * Carrega as configurações da empresa do usuário logado.
 * Usado em comprovantes, notas e cabeçalhos de impressão.
 */
export function useConfigEmpresa() {
  return useQuery({
    queryKey: ["config_empresa"],
    queryFn: async (): Promise<ConfigEmpresa | null> => {
      const { data, error } = await supabase
        .from("configuracoes_empresa")
        .select(
          "id, razao_social, nome_fantasia, cnpj, inscricao_estadual, inscricao_municipal, telefone, email, logradouro, numero, complemento, bairro, cidade, estado, cep, logo_url",
        )
        .maybeSingle();
      if (error) throw error;
      return (data as ConfigEmpresa | null) ?? null;
    },
    staleTime: 5 * 60 * 1000,
  });
}
