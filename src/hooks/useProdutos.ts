import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { dataClient } from "@/integrations/data";
import type {
  Produto,
  ProdutoComCategoria,
  TipoIdentificacao,
} from "@/integrations/data";

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
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categorias_produto")
        .select("id, nome, parent_id, ativo")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Categoria[];
    },
  });
}

export function useCreateCategoria() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (nome: string): Promise<Categoria> => {
      const client_uuid = crypto.randomUUID();
      const r = await dataClient.produtos.criarCategoria({ nome, client_uuid });
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
    queryFn: async () => {
      const { data, error } = await supabase
        .from("produtos")
        .select("*, variacoes:produto_variacoes(*)")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data as (Produto & { variacoes: Variacao[] }) | null;
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

export function useCreateProduto() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: ProdutoInput) => {
      if (!user) throw new Error("Não autenticado");
      // Cast: types gerados ainda não conhecem campos novos (qr_code, codigo_interno, etc.)
      const { data, error } = await supabase
        .from("produtos")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insert({ ...input, owner_id: user.id } as any)
        .select()
        .single();
      if (error) throw new Error(prettifyProdutoError(error.message));
      return data;
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
      const { data, error } = await supabase
        .from("produtos")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update(input as any)
        .eq("id", id)
        .select()
        .single();
      if (error) throw new Error(prettifyProdutoError(error.message));
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["produtos"] });
      qc.invalidateQueries({ queryKey: ["produto", vars.id] });
      toast.success("Produto atualizado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteProduto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("produtos").delete().eq("id", id);
      if (error) throw error;
    },
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
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      produto_id: string;
      sku: string;
      nome: string;
      atributos?: Record<string, string>;
      preco_custo?: number | null;
      preco_venda?: number | null;
    }) => {
      if (!user) throw new Error("Não autenticado");
      const { data, error } = await supabase
        .from("produto_variacoes")
        .insert({ ...input, atributos: input.atributos ?? {}, owner_id: user.id })
        .select()
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
    mutationFn: async ({ id }: { id: string; produto_id: string }) => {
      const { error } = await supabase.from("produto_variacoes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["produto", vars.produto_id] });
      toast.success("Variação removida.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
