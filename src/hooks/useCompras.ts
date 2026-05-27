import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";

export type CompraStatus =
  | "rascunho"
  | "pendente"
  | "aprovada"
  | "recebida_parcial"
  | "recebida"
  | "cancelada";

export type CompraItem = {
  id: string;
  compra_id: string;
  produto_id: string;
  variacao_id: string | null;
  descricao: string | null;
  quantidade: number;
  quantidade_recebida: number;
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
  data_vencimento?: string | null;
  numero_nf?: string | null;
  serie_nf?: string | null;
  desconto?: number;
  frete?: number;
  outros?: number;
  observacoes?: string | null;
  itens: CompraItemInput[];
  /**
   * Idempotência: o componente DEVE manter um UUID estável enquanto o
   * modal estiver aberto. Garante que duplo-clique / retry de rede
   * não criem duas compras.
   */
  client_uuid?: string | null;
};

// Totais (subtotal/total) agora são calculados server-side dentro da RPC
// `criar_compra` para evitar divergência entre cliente e banco.

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

      // Toda a gravação (compra + itens + cálculos) acontece atomicamente
      // dentro da RPC `criar_compra`. Idempotência cross-retry é garantida
      // pelo `_client_uuid` enviado pelo componente: reenviar o mesmo UUID
      // (duplo-clique, retry de rede) retorna a compra já existente em vez
      // de criar uma nova.
      const payload = {
        _numero: input.numero,
        _fornecedor_id: input.fornecedor_id,
        _data_emissao: input.data_emissao,
        _data_prevista: input.data_prevista ?? null,
        _data_vencimento: input.data_vencimento ?? null,
        _numero_nf: input.numero_nf ?? null,
        _serie_nf: input.serie_nf ?? null,
        _desconto: input.desconto ?? 0,
        _frete: input.frete ?? 0,
        _outros: input.outros ?? 0,
        _observacoes: input.observacoes ?? null,
        _status: "pendente",
        _client_uuid: input.client_uuid ?? null,
        _itens: input.itens.map((it) => ({
          produto_id: it.produto_id,
          variacao_id: it.variacao_id ?? null,
          descricao: it.descricao ?? null,
          quantidade: it.quantidade,
          preco_unitario: it.preco_unitario,
          desconto: it.desconto ?? 0,
        })),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("criar_compra", { _payload: payload });
      if (error) throw error;
      return data as { id: string; idempotent: boolean };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["compras"] });
      if (res?.idempotent) {
        toast.success("Compra já registrada (reenvio idempotente).");
      } else {
        toast.success("Compra registrada.");
      }
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

// ============ Recebimento parcial / item-a-item ============

export type ReceberItemInput = {
  item_id: string;
  quantidade: number;
};

export function useReceberCompraItens() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      compra_id: string;
      itens: ReceberItemInput[];
      data_recebimento?: string;
      gerar_financeiro?: boolean;
      data_vencimento?: string | null;
    }) => {
      const itensValidos = params.itens.filter((i) => i.quantidade > 0);
      if (itensValidos.length === 0) {
        throw new Error("Informe ao menos uma quantidade para receber.");
      }
      const args: {
        _compra_id: string;
        _itens: ReceberItemInput[];
        _data_recebimento: string;
        _gerar_financeiro: boolean;
        _data_vencimento?: string;
      } = {
        _compra_id: params.compra_id,
        _itens: itensValidos,
        _data_recebimento: params.data_recebimento ?? new Date().toISOString().slice(0, 10),
        _gerar_financeiro: params.gerar_financeiro ?? true,
      };
      if (params.data_vencimento) args._data_vencimento = params.data_vencimento;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("receber_compra_itens", args);
      if (error) throw error;
      return data as {
        compra_id: string;
        status: CompraStatus;
        pendente_total: number;
        recebido_total: number;
        itens_recebidos: number;
      };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["compras"] });
      qc.invalidateQueries({ queryKey: ["compra"] });
      qc.invalidateQueries({ queryKey: ["estoque-saldos"] });
      qc.invalidateQueries({ queryKey: ["movimentacoes"] });
      qc.invalidateQueries({ queryKey: ["financeiro-lancamentos"] });
      qc.invalidateQueries({ queryKey: ["fornecedor-metricas"] });
      if (res.status === "recebida") {
        toast.success("Compra totalmente recebida — estoque e financeiro atualizados.");
      } else {
        toast.success(`Recebimento parcial registrado (${res.itens_recebidos} item(ns)).`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ============ Métricas por fornecedor ============

export type FornecedorMetrica = {
  fornecedor_id: string;
  total_compras: number;
  valor_total: number;
  ultima_compra: string | null;
  compras_em_aberto: number;
};

export function useFornecedorMetricas() {
  return useQuery({
    queryKey: ["fornecedor-metricas"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("fornecedor_metricas");
      if (error) throw error;
      const rows = (data ?? []) as FornecedorMetrica[];
      const map = new Map<string, FornecedorMetrica>();
      for (const r of rows) {
        map.set(r.fornecedor_id, {
          ...r,
          total_compras: Number(r.total_compras ?? 0),
          valor_total: Number(r.valor_total ?? 0),
          compras_em_aberto: Number(r.compras_em_aberto ?? 0),
        });
      }
      return map;
    },
    staleTime: 30_000,
  });
}

// helper para gerar próximo número
export function gerarNumeroCompra() {
  const d = new Date();
  const yymm = `${d.getFullYear().toString().slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}`;
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `CMP-${yymm}-${rand}`;
}
