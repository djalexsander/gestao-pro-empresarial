import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";

export type Produto = {
  id: string;
  sku: string;
  codigo_barras: string | null;
  nome: string;
  descricao: string | null;
  marca: string | null;
  unidade: string;
  categoria_id: string | null;
  preco_custo: number;
  preco_venda: number;
  estoque_minimo: number;
  estoque_inicial: number;
  status: "ativo" | "inativo" | "descontinuado";
  ncm: string | null;
  created_at: string;
  updated_at: string;
};

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
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (nome: string) => {
      if (!user) throw new Error("Não autenticado");
      const { data, error } = await supabase
        .from("categorias_produto")
        .insert({ nome: nome.trim(), owner_id: user.id })
        .select()
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

export function useProdutos() {
  return useQuery({
    queryKey: ["produtos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("produtos")
        .select("*, categoria:categorias_produto(id, nome)")
        .order("nome");
      if (error) throw error;
      return data as Array<Produto & { categoria: { id: string; nome: string } | null }>;
    },
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
};

export function useCreateProduto() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: ProdutoInput) => {
      if (!user) throw new Error("Não autenticado");
      const { data, error } = await supabase
        .from("produtos")
        .insert({ ...input, owner_id: user.id })
        .select()
        .single();
      if (error) throw error;
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
        .update(input)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
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
