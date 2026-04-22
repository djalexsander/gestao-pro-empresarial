import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";

export type CompraStatus = "rascunho" | "pendente" | "aprovada" | "recebida" | "cancelada";

export type CompraItem = {
  id: string;
  compra_id: string;
  produto_id: string;
  variacao_id: string | null;
  descricao: string | null;
  quantidade: number;
  preco_unitario: number;
  desconto: number;
  total: number;
};

export type Compra = {
  id: string;
  numero: string;
  fornecedor_id: string | null;
  data_emissao: string;
  data_prevista: string | null;
  data_recebimento: string | null;
  numero_nf: string | null;
  serie_nf: string | null;
  subtotal: number;
  desconto: number;
  frete: number;
  outros: number;
  total: number;
  status: CompraStatus;
  observacoes: string | null;
  created_at: string;
  updated_at: string;
};

export type CompraComFornecedor = Compra & {
  fornecedor: { id: string; razao_social: string; nome_fantasia: string | null } | null;
};

export type CompraDetalhe = Compra & {
  fornecedor: { id: string; razao_social: string; nome_fantasia: string | null } | null;
  itens: Array<CompraItem & { produto: { id: string; sku: string; nome: string } | null }>;
};

export type CompraItemInput = {
  produto_id: string;
  variacao_id?: string | null;
  descricao?: string | null;
  quantidade: number;
  preco_unitario: number;
  desconto?: number;
};

export type CompraInput = {
  numero: string;
  fornecedor_id: string | null;
  data_emissao: string;
  data_prevista?: string | null;
  numero_nf?: string | null;
  serie_nf?: string | null;
  desconto?: number;
  frete?: number;
  outros?: number;
  observacoes?: string | null;
  itens: CompraItemInput[];
};

function calcularTotais(input: CompraInput) {
  const subtotal = input.itens.reduce(
    (acc, it) => acc + it.quantidade * it.preco_unitario - (it.desconto ?? 0),
    0
  );
  const total = subtotal - (input.desconto ?? 0) + (input.frete ?? 0) + (input.outros ?? 0);
  return { subtotal, total: Math.max(0, total) };
}

// ================= QUERIES =================

export function useCompras() {
  return useQuery({
    queryKey: ["compras"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compras")
        .select("*, fornecedor:fornecedores(id, razao_social, nome_fantasia)")
        .order("data_emissao", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as CompraComFornecedor[];
    },
  });
}

export function useCompra(id: string | undefined) {
  return useQuery({
    queryKey: ["compra", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compras")
        .select(
          "*, fornecedor:fornecedores(id, razao_social, nome_fantasia), itens:compra_itens(*, produto:produtos(id, sku, nome))"
        )
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data as CompraDetalhe | null;
    },
  });
}

// ================= MUTATIONS =================

export function useCreateCompra() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: CompraInput) => {
      if (!user) throw new Error("Não autenticado");
      if (input.itens.length === 0) throw new Error("Adicione pelo menos um item à compra.");

      const { subtotal, total } = calcularTotais(input);

      const { data: compra, error } = await supabase
        .from("compras")
        .insert({
          owner_id: user.id,
          numero: input.numero,
          fornecedor_id: input.fornecedor_id,
          data_emissao: input.data_emissao,
          data_prevista: input.data_prevista ?? null,
          numero_nf: input.numero_nf ?? null,
          serie_nf: input.serie_nf ?? null,
          desconto: input.desconto ?? 0,
          frete: input.frete ?? 0,
          outros: input.outros ?? 0,
          observacoes: input.observacoes ?? null,
          subtotal,
          total,
          status: "pendente",
        })
        .select()
        .single();
      if (error) throw error;

      const itensPayload: Array<{
        owner_id: string;
        compra_id: string;
        produto_id: string;
        variacao_id: string | null;
        descricao: string | null;
        quantidade: number;
        preco_unitario: number;
        desconto: number;
        total: number;
      }> = input.itens.map((it) => ({
        owner_id: user.id,
        compra_id: compra.id,
        produto_id: it.produto_id,
        variacao_id: it.variacao_id ?? null,
        descricao: it.descricao ?? null,
        quantidade: it.quantidade,
        preco_unitario: it.preco_unitario,
        desconto: it.desconto ?? 0,
        total: it.quantidade * it.preco_unitario - (it.desconto ?? 0),
      }));

      const { error: itensErr } = await supabase.from("compra_itens").insert(itensPayload);
      if (itensErr) {
        // rollback manual da compra para não deixar lixo
        await supabase.from("compras").delete().eq("id", compra.id);
        throw itensErr;
      }

      return compra;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["compras"] });
      toast.success("Compra registrada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateCompraStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: CompraStatus }) => {
      const { error } = await supabase
        .from("compras")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["compras"] });
      qc.invalidateQueries({ queryKey: ["compra"] });
      toast.success("Status atualizado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useReceberCompra() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data_recebimento,
      gerar_financeiro,
      data_vencimento,
    }: {
      id: string;
      data_recebimento?: string;
      gerar_financeiro?: boolean;
      data_vencimento?: string | null;
    }) => {
      const args: {
        _compra_id: string;
        _data_recebimento: string;
        _gerar_financeiro: boolean;
        _data_vencimento?: string;
      } = {
        _compra_id: id,
        _data_recebimento: data_recebimento ?? new Date().toISOString().slice(0, 10),
        _gerar_financeiro: gerar_financeiro ?? true,
      };
      if (data_vencimento) args._data_vencimento = data_vencimento;
      const { data, error } = await supabase.rpc("receber_compra", args);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["compras"] });
      qc.invalidateQueries({ queryKey: ["compra"] });
      qc.invalidateQueries({ queryKey: ["estoque-saldos"] });
      qc.invalidateQueries({ queryKey: ["movimentacoes"] });
      qc.invalidateQueries({ queryKey: ["financeiro-lancamentos"] });
      toast.success("Compra recebida — estoque e financeiro atualizados.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteCompra() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("compras").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["compras"] });
      toast.success("Compra excluída.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// helper para gerar próximo número
export function gerarNumeroCompra() {
  const d = new Date();
  const yymm = `${d.getFullYear().toString().slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}`;
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `CMP-${yymm}-${rand}`;
}
