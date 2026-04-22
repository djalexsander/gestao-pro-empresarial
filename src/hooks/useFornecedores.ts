import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";

export type Fornecedor = {
  id: string;
  tipo: "PF" | "PJ";
  razao_social: string;
  nome_fantasia: string | null;
  documento: string | null;
  inscricao_estadual: string | null;
  email: string | null;
  telefone: string | null;
  contato_nome: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  observacoes: string | null;
  status: "ativo" | "inativo";
  created_at: string;
  updated_at: string;
};

export type FornecedorInput = Omit<Fornecedor, "id" | "created_at" | "updated_at">;

export function useFornecedores() {
  return useQuery({
    queryKey: ["fornecedores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fornecedores")
        .select("*")
        .order("razao_social");
      if (error) throw error;
      return (data ?? []) as Fornecedor[];
    },
  });
}

export function useCreateFornecedor() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: FornecedorInput) => {
      if (!user) throw new Error("Não autenticado");
      const { data, error } = await supabase
        .from("fornecedores")
        .insert({ ...input, owner_id: user.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fornecedores"] });
      toast.success("Fornecedor cadastrado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateFornecedor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: FornecedorInput & { id: string }) => {
      const { data, error } = await supabase
        .from("fornecedores")
        .update(input)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fornecedores"] });
      toast.success("Fornecedor atualizado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteFornecedor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("fornecedores").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fornecedores"] });
      toast.success("Fornecedor removido.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
