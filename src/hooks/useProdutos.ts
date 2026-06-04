import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { dataClient } from "@/integrations/data";
import { getDataMode } from "@/integrations/data/mode";
import type { Produto, ProdutoComCategoria, TipoIdentificacao } from "@/integrations/data";

// Re-exports para preservar a API pública anterior deste módulo.
export type { Produto, TipoIdentificacao };

export type Categoria = {
  id: string;
  nome: string;
  parent_id: string | null;
  ativo: boolean;
};

export type Variacao = {
  id: string;
  produto_id: string;
  sku: string;
  nome: string;
  atributos: Record<string, string>;
  preco_custo: number | null;
  preco_venda: number | null;
  ativo: boolean;
};

// ================= CATEGORIAS =================

export function useCategorias() {
  return useQuery({
    queryKey: ["categorias"],
    queryFn: () => dataClient.categoriasProduto.list() as Promise<Categoria[]>,
  });
}

export function useCreateCategoria() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (nome: string): Promise<Categoria> => {
      const client_uuid = crypto.randomUUID();
      const r = await dataClient.produtos.criarCategoria({ nome, client_uuid });
      const mode = getDataMode();
      if (mode === "local-server" || mode === "local-terminal") {
        const rows = await dataClient.categoriasProduto.list({ incluir_inativas: true });
        const found = rows.find((categoria) => categoria.id === r.categoria_id);
        if (found) return found as Categoria;
      }
      const { data, error } = await supabase
        .from("categorias_produto")
        .select("id, nome, parent_id, ativo")
        .eq("id", r.categoria_id)
        .single();
      if (error) throw error;
      return data as Categoria;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categorias"] });
      toast.success("Categoria criada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ================= PRODUTOS =================

/**
 * Lista todos os produtos do tenant (com a categoria já joinada).
 * Desde a Fase 1, consome `dataClient` em vez de `supabase` direto —
 * o React Query e a queryKey continuam exatamente os mesmos.
 */
export function useProdutos() {
  return useQuery<ProdutoComCategoria[]>({
    queryKey: ["produtos"],
    queryFn: () => dataClient.produtos.listar(),
  });
}

export function useProduto(id: string | undefined) {
  return useQuery({
    queryKey: ["produto", id],
    enabled: !!id,
    queryFn: () =>
      dataClient.produtos.get(id!) as Promise<(Produto & { variacoes: Variacao[] }) | null>,
  });
}

export type ProdutoInput = {
  sku: string;
  codigo_barras?: string | null;
  qr_code?: string | null;
  codigo_interno?: string | null;
  tipo_identificacao_principal?: TipoIdentificacao;
  observacao_tecnica?: string | null;
  nome: string;
  descricao?: string | null;
  marca?: string | null;
  unidade: string;
  categoria_id?: string | null;
  preco_custo: number;
  preco_venda: number;
  estoque_minimo: number;
  estoque_inicial?: number;
  status: "ativo" | "inativo" | "descontinuado";
  ncm?: string | null;
  vendido_por_peso?: boolean;
  plu?: string | null;
  aceita_etiqueta_balanca?: boolean;
  casas_decimais_quantidade?: number;
};

function prettifyProdutoError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("produtos_owner_codigo_barras_unique"))
    return "Este código de barras já está cadastrado em outro produto.";
  if (m.includes("produtos_owner_qr_code_unique"))
    return "Este QR Code já está cadastrado em outro produto.";
  if (m.includes("produtos_owner_sku_unique"))
    return "Este SKU já está cadastrado em outro produto.";
  if (m.includes("produtos_owner_codigo_interno_unique"))
    return "Este código interno já está cadastrado em outro produto.";
  return msg;
}

async function fetchProdutoRow(id: string) {
  const { data, error } = await supabase.from("produtos").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

function mapProdutoErr(e: unknown): Error {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msg: string = (e as any)?.message ?? String(e);
  return new Error(prettifyProdutoError(msg));
}

export function useCreateProduto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProdutoInput) => {
      const client_uuid = crypto.randomUUID();
      try {
        const r = await dataClient.produtos.criar({ ...input, client_uuid });
        // In local modes, prefer reading from local adapter instead of Supabase
        const mode = getDataMode();
        if (mode === "local-server" || mode === "local-terminal") {
          try {
            const list = (await dataClient.produtos.listar()) as ProdutoComCategoria[];
            const found = list.find((p) => p.id === r.produto_id);
            if (found) return found as unknown as Produto;
          } catch {
            // fallthrough to remote fetch as last resort
          }
        }
        return await fetchProdutoRow(r.produto_id);
      } catch (e) {
        throw mapProdutoErr(e);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["produtos"] });
      qc.invalidateQueries({ queryKey: ["estoque-saldos"] });
      toast.success("Produto cadastrado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateProduto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: ProdutoInput & { id: string }) => {
      try {
        const r = await dataClient.produtos.editar({
          produto_id: id,
          ...input,
        });
        const mode = getDataMode();
        if (mode === "local-server" || mode === "local-terminal") {
          try {
            const list = (await dataClient.produtos.listar()) as ProdutoComCategoria[];
            const found = list.find((p) => p.id === r.produto_id);
            if (found) return found as unknown as Produto;
          } catch {
            // fallthrough
          }
        }
        return await fetchProdutoRow(r.produto_id);
      } catch (e) {
        throw mapProdutoErr(e);
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["produtos"] });
      qc.invalidateQueries({ queryKey: ["produto", vars.id] });
      toast.success("Produto atualizado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * Hard delete. A RPC bloqueia se houver vendas/compras/movimentos/lotes
 * vinculados — nesse caso, oriente o usuário a inativar o produto.
 */
export function useDeleteProduto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => dataClient.produtos.excluir(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["produtos"] });
      qc.invalidateQueries({ queryKey: ["estoque-saldos"] });
      toast.success("Produto excluído.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ================= VARIAÇÕES =================

export function useCreateVariacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      produto_id: string;
      sku: string;
      nome: string;
      atributos?: Record<string, string>;
      preco_custo?: number | null;
      preco_venda?: number | null;
    }) => {
      const client_uuid = crypto.randomUUID();
      const r = await dataClient.produtos.criarVariacao({
        ...input,
        client_uuid,
      });
      // Mantém contrato (retorno usado por dialogs): re-busca a linha.
      const { data, error } = await supabase
        .from("produto_variacoes")
        .select("*")
        .eq("id", r.variacao_id)
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["produto", vars.produto_id] });
      toast.success("Variação criada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteVariacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; produto_id: string }) =>
      dataClient.produtos.excluirVariacao(id),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["produto", vars.produto_id] });
      toast.success("Variação removida.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
