import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type FormaPagamento =
  | "dinheiro"
  | "pix"
  | "cartao_debito"
  | "cartao_credito"
  | "boleto"
  | "transferencia"
  | "cheque"
  | "outro";

export type StatusPagamento = "pago" | "pendente" | "parcial" | "cancelado";
export type VendaStatus =
  | "rascunho"
  | "aprovada"
  | "faturada"
  | "cancelada"
  | string;

export interface FinalizarVendaItem {
  produto_id: string;
  quantidade: number;
  preco_unitario: number;
  desconto: number;
  descricao?: string | null;
}

export interface FinalizarVendaInput {
  cliente_id: string | null;
  subtotal: number;
  desconto: number;
  total: number;
  forma_pagamento: FormaPagamento;
  status_pagamento: StatusPagamento;
  valor_recebido: number | null;
  troco: number | null;
  observacao: string | null;
  itens: FinalizarVendaItem[];
  gerar_financeiro?: boolean;
}

export function useFinalizarVendaPDV() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: FinalizarVendaInput) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("finalizar_venda_pdv", {
        _cliente_id: input.cliente_id,
        _subtotal: input.subtotal,
        _desconto: input.desconto,
        _total: input.total,
        _forma: input.forma_pagamento,
        _status_pagamento: input.status_pagamento,
        _valor_recebido: input.valor_recebido,
        _troco: input.troco,
        _observacao: input.observacao,
        _itens: input.itens,
        _gerar_financeiro: input.gerar_financeiro ?? true,
      });
      if (error) throw error;
      return data as string; // venda_id
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendas"] });
      qc.invalidateQueries({ queryKey: ["estoque-saldos"] });
      qc.invalidateQueries({ queryKey: ["movimentacoes"] });
      qc.invalidateQueries({ queryKey: ["financeiro"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// =============== Saldos em lote (para validação no PDV) ===============
export function useSaldosLote() {
  return useMutation({
    mutationFn: async (produtoIds: string[]) => {
      if (produtoIds.length === 0) return new Map<string, number>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("saldos_estoque_lote", {
        _produto_ids: produtoIds,
      });
      if (error) throw error;
      const map = new Map<string, number>();
      for (const row of (data ?? []) as { produto_id: string; saldo: number }[]) {
        map.set(row.produto_id, Number(row.saldo) || 0);
      }
      return map;
    },
  });
}

// =============== Listagem de vendas ===============
export interface VendaListItem {
  id: string;
  numero: string;
  cliente_id: string | null;
  cliente_nome: string | null;
  data_emissao: string;
  data_finalizacao: string | null;
  total: number;
  status: VendaStatus;
  status_pagamento: StatusPagamento | string;
  forma_pagamento: FormaPagamento | null;
}

export function useVendas() {
  return useQuery({
    queryKey: ["vendas", "list"],
    queryFn: async (): Promise<VendaListItem[]> => {
      const { data, error } = await supabase
        .from("vendas")
        .select(
          "id, numero, cliente_id, data_emissao, data_finalizacao, total, status, status_pagamento, forma_pagamento, cliente:clientes(nome)",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((v: any) => ({
        id: v.id,
        numero: v.numero,
        cliente_id: v.cliente_id,
        cliente_nome: v.cliente?.nome ?? null,
        data_emissao: v.data_emissao,
        data_finalizacao: v.data_finalizacao,
        total: Number(v.total) || 0,
        status: v.status,
        status_pagamento: v.status_pagamento,
        forma_pagamento: v.forma_pagamento,
      }));
    },
  });
}

// =============== Detalhe de venda ===============
export interface VendaDetalhe {
  id: string;
  numero: string;
  cliente_nome: string | null;
  data_emissao: string;
  data_finalizacao: string | null;
  subtotal: number;
  desconto: number;
  total: number;
  valor_recebido: number | null;
  troco: number | null;
  status: VendaStatus;
  status_pagamento: string;
  forma_pagamento: FormaPagamento | null;
  observacoes: string | null;
  itens: Array<{
    id: string;
    produto_id: string;
    descricao: string | null;
    quantidade: number;
    preco_unitario: number;
    desconto: number;
    total: number;
    produto_nome: string | null;
    sku: string | null;
  }>;
}

export function useVendaDetalhe(vendaId: string | null) {
  return useQuery({
    queryKey: ["vendas", "detalhe", vendaId],
    enabled: !!vendaId,
    queryFn: async (): Promise<VendaDetalhe | null> => {
      if (!vendaId) return null;
      const { data: v, error } = await supabase
        .from("vendas")
        .select(
          "id, numero, data_emissao, data_finalizacao, subtotal, desconto, total, valor_recebido, troco, status, status_pagamento, forma_pagamento, observacoes, cliente:clientes(nome)",
        )
        .eq("id", vendaId)
        .single();
      if (error) throw error;

      const { data: itens, error: e2 } = await supabase
        .from("venda_itens")
        .select(
          "id, produto_id, descricao, quantidade, preco_unitario, desconto, total, produto:produtos(nome, sku)",
        )
        .eq("venda_id", vendaId);
      if (e2) throw e2;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vAny = v as any;
      return {
        id: vAny.id,
        numero: vAny.numero,
        cliente_nome: vAny.cliente?.nome ?? null,
        data_emissao: vAny.data_emissao,
        data_finalizacao: vAny.data_finalizacao,
        subtotal: Number(vAny.subtotal) || 0,
        desconto: Number(vAny.desconto) || 0,
        total: Number(vAny.total) || 0,
        valor_recebido: vAny.valor_recebido,
        troco: vAny.troco,
        status: vAny.status,
        status_pagamento: vAny.status_pagamento,
        forma_pagamento: vAny.forma_pagamento,
        observacoes: vAny.observacoes,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        itens: (itens ?? []).map((i: any) => ({
          id: i.id,
          produto_id: i.produto_id,
          descricao: i.descricao,
          quantidade: Number(i.quantidade) || 0,
          preco_unitario: Number(i.preco_unitario) || 0,
          desconto: Number(i.desconto) || 0,
          total: Number(i.total) || 0,
          produto_nome: i.produto?.nome ?? null,
          sku: i.produto?.sku ?? null,
        })),
      };
    },
  });
}

// =============== Cancelar venda (estorno) ===============
export function useCancelarVenda() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      venda_id,
      motivo,
    }: {
      venda_id: string;
      motivo?: string | null;
    }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("cancelar_venda", {
        _venda_id: venda_id,
        _motivo: motivo ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendas"] });
      qc.invalidateQueries({ queryKey: ["estoque-saldos"] });
      qc.invalidateQueries({ queryKey: ["movimentacoes"] });
      qc.invalidateQueries({ queryKey: ["financeiro"] });
      toast.success("Venda cancelada e movimentações estornadas.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
