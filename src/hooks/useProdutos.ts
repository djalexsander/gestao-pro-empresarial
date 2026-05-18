import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dataClient } from "@/integrations/data";
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
      // Local-first: gera UUID no cliente para que o id seja idêntico em
      // SQLite local e Supabase, eliminando reconciliação posterior.
      const categoria_id = crypto.randomUUID();
      console.debug("[LOCAL_FIRST] categoria.criar", { categoria_id });
      const r = await dataClient.produtos.criarCategoria({
        nome,
        client_uuid,
        categoria_id,
      });
      return { id: r.categoria_id, nome, parent_id: null, ativo: true };
    },
    // Atualização otimista: insere a categoria no cache antes do round-trip.
    onMutate: async (nome: string) => {
      await qc.cancelQueries({ queryKey: ["categorias"] });
      const previous = qc.getQueryData<Categoria[]>(["categorias"]);
      const optimistic: Categoria = {
        id: `optimistic-${crypto.randomUUID()}`,
        nome,
        parent_id: null,
        ativo: true,
      };
      qc.setQueryData<Categoria[]>(["categorias"], (curr) =>
        curr ? [...curr, optimistic] : [optimistic],
      );
      return { previous };
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(["categorias"], ctx.previous);
      toast.error(e.message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["categorias"] });
    },
    onSuccess: () => toast.success("Categoria criada."),
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
    queryFn: async () => {
      if (!id) return null;
      return (await dataClient.produtos.get(id)) as unknown as
        | (Produto & { variacoes: Variacao[] })
        | null;
    },
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
  const p = await dataClient.produtos.get(id);
  if (!p) throw new Error("Produto não encontrado.");
  return p;
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
      // Local-first: id gerado no cliente — Supabase usa o mesmo id,
      // permitindo materialização imediata no SQLite local e sync sem duplicar.
      const produto_id = crypto.randomUUID();
      console.debug("[LOCAL_FIRST] produto.criar", { produto_id });
      try {
        const r = await dataClient.produtos.criar({
          ...input,
          client_uuid,
          produto_id,
        });
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
      // Local-first: id de variação gerado no cliente.
      const variacao_id = crypto.randomUUID();
      console.debug("[LOCAL_FIRST] variacao.criar", { variacao_id });
      const r = await dataClient.produtos.criarVariacao({
        ...input,
        client_uuid,
        variacao_id,
      });
      return { id: r.variacao_id };
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
