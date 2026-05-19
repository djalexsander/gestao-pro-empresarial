import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dataClient } from "@/integrations/data";
import type { Produto, ProdutoComCategoria, TipoIdentificacao } from "@/integrations/data";
import { friendlyDeleteError, logSoftDelete } from "@/lib/softDeleteError";

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
    mutationFn: async (
      input: ProdutoInput & { __produto_id?: string },
    ) => {
      const client_uuid = crypto.randomUUID();
      // Local-first: id gerado no cliente — Supabase usa o mesmo id,
      // permitindo materialização imediata no SQLite local e sync sem duplicar.
      const produto_id = input.__produto_id ?? crypto.randomUUID();
      const { __produto_id: _ignored, ...rest } = input;
      console.debug("[LOCAL_FIRST] produto.criar", { produto_id });
      try {
        const r = await dataClient.produtos.criar({
          ...rest,
          client_uuid,
          produto_id,
        });
        return await fetchProdutoRow(r.produto_id);
      } catch (e) {
        throw mapProdutoErr(e);
      }
    },
    // Otimista: insere placeholder no cache para refletir imediatamente.
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["produtos"] });
      const previous = qc.getQueryData<ProdutoComCategoria[]>(["produtos"]);
      const tempId = crypto.randomUUID();
      // anexa o id para que o mutationFn use o mesmo no servidor.
      (input as ProdutoInput & { __produto_id?: string }).__produto_id = tempId;
      const nowIso = new Date().toISOString();
      const optimistic: ProdutoComCategoria = {
        id: tempId,
        sku: input.sku,
        codigo_barras: input.codigo_barras ?? null,
        qr_code: input.qr_code ?? null,
        codigo_interno: input.codigo_interno ?? null,
        tipo_identificacao_principal:
          input.tipo_identificacao_principal ?? "sku",
        observacao_tecnica: input.observacao_tecnica ?? null,
        nome: input.nome,
        descricao: input.descricao ?? null,
        marca: input.marca ?? null,
        unidade: input.unidade,
        categoria_id: input.categoria_id ?? null,
        preco_custo: input.preco_custo,
        preco_venda: input.preco_venda,
        estoque_minimo: input.estoque_minimo,
        estoque_inicial: input.estoque_inicial ?? 0,
        status: input.status,
        ncm: input.ncm ?? null,
        created_at: nowIso,
        updated_at: nowIso,
        categoria: null,
      };
      qc.setQueryData<ProdutoComCategoria[]>(["produtos"], (curr) =>
        curr ? [optimistic, ...curr] : [optimistic],
      );
      return { previous };
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(["produtos"], ctx.previous);
      toast.error(e.message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["produtos"] });
      qc.invalidateQueries({ queryKey: ["estoque-saldos"] });
    },
    onSuccess: () => toast.success("Produto cadastrado."),
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
    // Otimista: aplica o patch na listagem para refletir imediatamente na UI.
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["produtos"] });
      const previous = qc.getQueryData<ProdutoComCategoria[]>(["produtos"]);
      qc.setQueryData<ProdutoComCategoria[]>(["produtos"], (curr) =>
        curr?.map((p) =>
          p.id === vars.id
            ? ({ ...p, ...vars, id: p.id } as ProdutoComCategoria)
            : p,
        ),
      );
      return { previous };
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(["produtos"], ctx.previous);
      toast.error(e.message);
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: ["produtos"] });
      qc.invalidateQueries({ queryKey: ["produto", vars.id] });
    },
    onSuccess: () => toast.success("Produto atualizado."),
  });
}

/**
 * "Excluir" produto = soft delete (inativação).
 * Preserva todo o histórico (vendas, compras, movimentos, lotes) e simplesmente
 * marca o produto como `inativo`. O produto some das listas ativas, do PDV,
 * scanner e busca, mas continua sendo referenciado por registros antigos.
 *
 * Local-first: o adapter local-server grava no SQLite e gera outbox; o cloud
 * recebe via fallback ou sincronização posterior.
 */
export function useDeleteProduto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (import.meta.env.DEV) console.debug("[PRODUTO_DELETE]", { produto_id: id, modo: "inativar" });
      try {
        const r = await dataClient.produtos.alterarStatus({ produto_id: id, status: "inativo" });
        if (import.meta.env.DEV) console.debug("[PRODUTO_INATIVAR_LOCAL]", { produto_id: id, status: r.status });
        return r;
      } catch (err) {
        if (import.meta.env.DEV) console.error("[PRODUTO_DELETE_ERROR]", err);
        const msg = err instanceof Error ? err.message : String(err);
        const isNet =
          /failed to fetch|networkerror|load failed|fetch failed/i.test(msg) ||
          (typeof err === "object" && err !== null && "name" in err && (err as { name?: string }).name === "TypeError");
        if (isNet) {
          throw new Error("Não foi possível desativar o produto agora. Verifique sua conexão e tente novamente.");
        }
        throw err instanceof Error ? err : new Error(msg);
      }
    },
    // Otimista: remove da listagem antes do round-trip.
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ["produtos"] });
      const previous = qc.getQueryData<ProdutoComCategoria[]>(["produtos"]);
      qc.setQueryData<ProdutoComCategoria[]>(["produtos"], (curr) =>
        curr?.filter((p) => p.id !== id),
      );
      return { previous };
    },
    onError: (e: Error, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(["produtos"], ctx.previous);
      toast.error(e.message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["produtos"] });
      qc.invalidateQueries({ queryKey: ["estoque-saldos"] });
    },
    onSuccess: () => toast.success("Produto desativado."),
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
