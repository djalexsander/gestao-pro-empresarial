import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { dataClient } from "@/integrations/data";
import type { Produto, ProdutoComCategoria, TipoIdentificacao } from "@/integrations/data";
import { prettifyProdutoError } from "@/lib/produto-erros";

// Re-exports para preservar a API pública anterior deste módulo.
export type { Produto, TipoIdentificacao };

export type Categoria = {
  id: string;
  nome: string;
  parent_id: string | null;
  ativo: boolean;
  descricao?: string | null;
  owner_id?: string | null;
  company_id?: string | null;
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
    queryFn: async () => {
      console.info("[categorias-produto] LISTAR CATEGORIAS", {
        source: "cloud",
      });
      const categorias = (await dataClient.categoriasProduto.list()) as Categoria[];
      console.info("[categorias-produto] CATEGORIA RETORNADA", {
        total: categorias.length,
        ids: categorias.map((c) => c.id),
        owner_ids: Array.from(new Set(categorias.map((c) => c.owner_id ?? null))),
        company_ids: Array.from(new Set(categorias.map((c) => c.company_id ?? null))),
      });
      return categorias;
    },
  });
}

export function useCreateCategoria() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (nome: string): Promise<Categoria> => {
      const client_uuid = crypto.randomUUID();
      console.info("[categorias-produto] CREATE CATEGORIA", {
        nome,
        client_uuid,
        source: "cloud",
      });
      const r = await dataClient.produtos.criarCategoria({ nome, client_uuid });
      console.info("[categorias-produto] CREATE CATEGORIA result", {
        categoria_id: r.categoria_id,
        idempotente: r.idempotente,
      });
      const categorias = (await dataClient.categoriasProduto.list({
        incluir_inativas: true,
      })) as Categoria[];
      const local = categorias.find((c) => c.id === r.categoria_id);
      if (local) {
        console.info("[categorias-produto] CREATE CATEGORIA loaded", {
          categoria_id: local.id,
          owner_id: local.owner_id ?? null,
          company_id: local.company_id ?? null,
        });
        return local;
      }
      const { data, error } = await supabase
        .from("categorias_produto")
        .select("id, nome, parent_id, ativo, descricao, owner_id")
        .eq("id", r.categoria_id)
        .single();
      if (error) throw error;
      return data as Categoria;
    },
    onSuccess: (categoria) => {
      qc.setQueryData<Categoria[]>(["categorias"], (old = []) => {
        const next = old.some((c) => c.id === categoria.id)
          ? old.map((c) => (c.id === categoria.id ? { ...c, ...categoria } : c))
          : [...old, categoria];
        return next.sort((a, b) => a.nome.localeCompare(b.nome));
      });
      void qc.invalidateQueries({ queryKey: ["categorias"] });
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
    queryFn: async () => {
      return dataClient.produtos.get(id!) as Promise<
        (Produto & { variacoes: Variacao[] }) | null
      >;
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

async function fetchProdutoRow(id: string) {
  const { data, error } = await supabase.from("produtos").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

function mapProdutoErr(e: unknown): Error {
  return new Error(prettifyProdutoError(e));
}

async function ownerIdAtual(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

/**
 * Lista os SKUs do owner atual que começam com o prefixo informado.
 * Usada pelo gerador de SKU para calcular o próximo sufixo livre — mesmo
 * escopo (owner_id) do índice único do banco, então o resultado é sempre
 * coerente com o que a constraint vai aceitar.
 */
export async function buscarSkusComPrefixo(prefixo: string): Promise<string[]> {
  const valor = prefixo.trim();
  if (!valor) return [];
  const ownerId = await ownerIdAtual();
  if (!ownerId) return [];
  const { data, error } = await supabase
    .from("produtos")
    .select("sku")
    .eq("owner_id", ownerId)
    .ilike("sku", `${valor}%`);
  if (error) throw error;
  return (data ?? []).map((r) => r.sku);
}

/**
 * Verifica se o SKU já está em uso por OUTRO produto da mesma empresa
 * (mesmo owner_id). Em edição, `ignorarProdutoId` exclui o próprio produto
 * da checagem — editar um produto mantendo o SKU atual não deve acusar
 * duplicidade. É só uma checagem prévia para UX: a autoridade final contra
 * corrida entre duas estações continua sendo o índice único do banco.
 */
export async function skuJaCadastrado(sku: string, ignorarProdutoId?: string): Promise<boolean> {
  const valor = sku.trim();
  if (!valor) return false;
  const ownerId = await ownerIdAtual();
  if (!ownerId) return false;
  let query = supabase
    .from("produtos")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("sku", valor)
    .limit(1);
  if (ignorarProdutoId) {
    query = query.neq("id", ignorarProdutoId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export function useCreateProduto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProdutoInput) => {
      const client_uuid = crypto.randomUUID();
      try {
        const r = await dataClient.produtos.criar({ ...input, client_uuid });
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
      try {
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
      } catch (e) {
        throw mapProdutoErr(e);
      }
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
