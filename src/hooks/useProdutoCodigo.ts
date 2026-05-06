import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dataClient } from "@/integrations/data";
import type { CodigoTipo, ProdutoBuscaResult } from "@/integrations/data";
import type { ProdutoCodigoDomain } from "@/integrations/data/extra-adapters";

// Re-exports para preservar a API pública anterior do módulo.
export type { CodigoTipo, ProdutoBuscaResult };

/**
 * Busca um produto por qualquer código (barras, QR, SKU, interno, alternativo)
 * dentro da empresa do usuário autenticado.
 */
export async function buscarProdutoPorCodigo(codigo: string): Promise<ProdutoBuscaResult | null> {
  return dataClient.produtos.buscarPorCodigo(codigo);
}

/** React Query wrapper para busca por código (manual/imperativa). */
export function useBuscarProdutoPorCodigo(codigo: string | null | undefined) {
  return useQuery({
    queryKey: ["produto-por-codigo", codigo],
    enabled: !!codigo && codigo.trim().length > 0,
    queryFn: () => buscarProdutoPorCodigo(codigo!),
    staleTime: 30_000,
  });
}

// ================ CRUD de códigos auxiliares ================

export type ProdutoCodigo = ProdutoCodigoDomain;

export function useProdutoCodigos(produtoId: string | undefined) {
  return useQuery({
    queryKey: ["produto-codigos", produtoId],
    enabled: !!produtoId,
    queryFn: () => dataClient.produtoCodigos.list(produtoId!),
  });
}

export function useAddProdutoCodigo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      produto_id: string;
      tipo_codigo: CodigoTipo;
      valor_codigo: string;
      observacao?: string | null;
    }) => {
      const valor = input.valor_codigo.trim();
      if (!valor) throw new Error("Código vazio");
      const client_uuid = crypto.randomUUID();
      try {
        const r = await dataClient.produtos.adicionarCodigo({
          produto_id: input.produto_id,
          tipo_codigo: input.tipo_codigo,
          valor_codigo: valor,
          observacao: input.observacao ?? null,
          client_uuid,
        });
        return { id: r.codigo_id } as ProdutoCodigo;
      } catch (e) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const msg: string = (e as any)?.message ?? String(e);
        if (msg.toLowerCase().includes("duplicate")) {
          throw new Error("Este código já está cadastrado em outro produto.");
        }
        throw new Error(msg);
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["produto-codigos", vars.produto_id] });
      toast.success("Código adicionado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteProdutoCodigo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; produto_id: string }) =>
      dataClient.produtos.excluirCodigo(id),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["produto-codigos", vars.produto_id] });
      toast.success("Código removido.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
