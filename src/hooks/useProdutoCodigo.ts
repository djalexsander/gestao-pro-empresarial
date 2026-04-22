import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";

export type CodigoTipo =
  | "codigo_barras"
  | "qr_code"
  | "sku"
  | "interno"
  | "alternativo";

export interface ProdutoBuscaResult {
  produto_id: string;
  sku: string;
  nome: string;
  codigo_barras: string | null;
  qr_code: string | null;
  codigo_interno: string | null;
  tipo_identificacao_principal: string;
  preco_venda: number;
  preco_custo: number;
  unidade: string;
  status: "ativo" | "inativo" | "descontinuado";
  categoria_id: string | null;
  categoria_nome: string | null;
  fonte: CodigoTipo;
  saldo_estoque: number;
}

/**
 * Busca um produto por qualquer código (barras, QR, SKU, interno, alternativo)
 * dentro da empresa do usuário autenticado.
 */
export async function buscarProdutoPorCodigo(
  codigo: string,
): Promise<ProdutoBuscaResult | null> {
  const valor = codigo.trim();
  if (!valor) return null;
  // Cast para `any` porque a função RPC ainda não está em supabase/types.ts
  // (gerado automaticamente). Após a próxima sincronização tipos, o cast pode sair.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("buscar_produto_por_codigo", {
    _codigo: valor,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    produto_id: row.produto_id,
    sku: row.sku,
    nome: row.nome,
    codigo_barras: row.codigo_barras,
    qr_code: row.qr_code,
    codigo_interno: row.codigo_interno,
    tipo_identificacao_principal: row.tipo_identificacao_principal,
    preco_venda: Number(row.preco_venda ?? 0),
    preco_custo: Number(row.preco_custo ?? 0),
    unidade: row.unidade,
    status: row.status,
    categoria_id: row.categoria_id,
    categoria_nome: row.categoria_nome,
    fonte: row.fonte as CodigoTipo,
    saldo_estoque: Number(row.saldo_estoque ?? 0),
  };
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

export interface ProdutoCodigo {
  id: string;
  produto_id: string;
  variacao_id: string | null;
  tipo_codigo: CodigoTipo;
  valor_codigo: string;
  observacao: string | null;
  created_at: string;
}

export function useProdutoCodigos(produtoId: string | undefined) {
  return useQuery({
    queryKey: ["produto-codigos", produtoId],
    enabled: !!produtoId,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("produto_codigos")
        .select("id, produto_id, variacao_id, tipo_codigo, valor_codigo, observacao, created_at")
        .eq("produto_id", produtoId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ProdutoCodigo[];
    },
  });
}

export function useAddProdutoCodigo() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      produto_id: string;
      tipo_codigo: CodigoTipo;
      valor_codigo: string;
      observacao?: string | null;
    }) => {
      if (!user) throw new Error("Não autenticado");
      const valor = input.valor_codigo.trim();
      if (!valor) throw new Error("Código vazio");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("produto_codigos")
        .insert({
          owner_id: user.id,
          produto_id: input.produto_id,
          tipo_codigo: input.tipo_codigo,
          valor_codigo: valor,
          observacao: input.observacao ?? null,
        })
        .select()
        .single();
      if (error) {
        if (String(error.message).toLowerCase().includes("duplicate")) {
          throw new Error("Este código já está cadastrado em outro produto.");
        }
        throw error;
      }
      return data as ProdutoCodigo;
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
    mutationFn: async ({ id }: { id: string; produto_id: string }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("produto_codigos")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["produto-codigos", vars.produto_id] });
      toast.success("Código removido.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
