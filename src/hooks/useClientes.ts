import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ClienteLite = {
  id: string;
  nome: string;
  nome_fantasia: string | null;
  documento: string | null;
};

export function useClientes() {
  return useQuery({
    queryKey: ["clientes-lite"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clientes")
        .select("id, nome, nome_fantasia, documento")
        .eq("status", "ativo")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as ClienteLite[];
    },
  });
}
