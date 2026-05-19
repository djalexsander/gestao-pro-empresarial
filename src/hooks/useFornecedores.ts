import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
 * "Remover" fornecedor = soft delete (inativação).
 * Não apaga compras nem lançamentos vinculados — o fornecedor continua
 * referenciado historicamente, apenas deixa de aparecer para novas operações.
 * Local-first: o adapter local-server grava no SQLite e gera outbox; o cloud
 * é atingido pelo fallback ou via sincronização posterior.
 */
export function useDeleteFornecedor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      logSoftDelete("fornecedor", id, { acao: "inativar" });
      try {
        const r = await dataClient.fornecedores.alterarStatus({
          fornecedor_id: id,
          status: "inativo",
        });
        if (import.meta.env.DEV) console.debug("[INATIVAR_LOCAL]", { entidade: "fornecedor", id });
        return r;
      } catch (err) {
        throw friendlyDeleteError(err, "fornecedor");
      }
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["fornecedores"] });
      const snaps = qc.getQueriesData<Fornecedor[]>({ queryKey: ["fornecedores"] });
      snaps.forEach(([k, prev]) => {
        if (!Array.isArray(prev)) return;
        qc.setQueryData<Fornecedor[]>(k, prev.filter((f) => f.id !== id));
      });
      return { snaps };
    },
    onError: (e: Error, _v, ctx) => {
      ctx?.snaps?.forEach(([k, v]) => qc.setQueryData(k, v));
      toast.error(e.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fornecedores"] });
      toast.success("Fornecedor inativado.");
    },
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
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ["fornecedores"] });
      const snaps = qc.getQueriesData<Fornecedor[]>({ queryKey: ["fornecedores"] });
      snaps.forEach(([k, prev]) => {
        if (!Array.isArray(prev)) return;
        qc.setQueryData<Fornecedor[]>(k, prev.map((f) => (f.id === id ? { ...f, status } : f)));
      });
      return { snaps };
    },
    onError: (e: Error, _v, ctx) => {
      ctx?.snaps?.forEach(([k, v]) => qc.setQueryData(k, v));
      toast.error(e.message);
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["fornecedores"] });
      toast.success(
        vars.status === "ativo" ? "Fornecedor ativado" : "Fornecedor inativado",
      );
    },
  });
}
