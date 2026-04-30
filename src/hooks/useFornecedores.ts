import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { dataClient } from "@/integrations/data";

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
    queryFn: () => dataClient.fornecedores.list() as Promise<Fornecedor[]>,
  });
}

async function fetchFornecedorById(id: string): Promise<Fornecedor> {
  return dataClient.fornecedores.get(id) as Promise<Fornecedor>;
}

export function useCreateFornecedor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: FornecedorInput): Promise<Fornecedor> => {
      // Idempotência: 1 UUID por chamada (retries da mesma mutation reusam).
      const client_uuid = crypto.randomUUID();
      const r = await dataClient.fornecedores.criar({ ...input, client_uuid });
      return fetchFornecedorById(r.fornecedor_id);
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
    mutationFn: async ({
      id,
      ...input
    }: FornecedorInput & { id: string }): Promise<Fornecedor> => {
      const r = await dataClient.fornecedores.editar({
        fornecedor_id: id,
        ...input,
      });
      return fetchFornecedorById(r.fornecedor_id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fornecedores"] });
      toast.success("Fornecedor atualizado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * Hard delete. A RPC bloqueia se houver compras ou lançamentos vinculados —
 * nesse caso, oriente o usuário a inativar via `useToggleFornecedorStatus`.
 */
export function useDeleteFornecedor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => dataClient.fornecedores.excluir(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fornecedores"] });
      toast.success("Fornecedor removido.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * Soft delete: alterna `ativo` ↔ `inativo`. Recomendado quando o fornecedor
 * já tem compras ou lançamentos vinculados (a exclusão é bloqueada nesse
 * caso). Preserva o histórico.
 */
export function useToggleFornecedorStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: "ativo" | "inativo";
    }) =>
      dataClient.fornecedores.alterarStatus({ fornecedor_id: id, status }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["fornecedores"] });
      toast.success(
        vars.status === "ativo" ? "Fornecedor ativado" : "Fornecedor inativado",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
