import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { dataClient } from "@/integrations/data";
import type {
  CancelarVendaResumo as DataCancelarVendaResumo,
  FinalizarVendaInput as DataFinalizarVendaInput,
  FinalizarVendaItem as DataFinalizarVendaItem,
  FinalizarVendaPagamento as DataFinalizarVendaPagamento,
  FormaPagamento as DataFormaPagamento,
  StatusPagamento as DataStatusPagamento,
} from "@/integrations/data";

// Re-exports para compatibilidade total com componentes que importam daqui.
export type FormaPagamento = DataFormaPagamento;
export type StatusPagamento = DataStatusPagamento;
export type FinalizarVendaItem = DataFinalizarVendaItem;
export type FinalizarVendaPagamento = DataFinalizarVendaPagamento;
export type FinalizarVendaInput = DataFinalizarVendaInput;
export type CancelarVendaResumo = DataCancelarVendaResumo;

export type VendaStatus =
  | "rascunho"
  | "aprovada"
  | "faturada"
  | "cancelada"
  | string;

/**
 * Finaliza uma venda no PDV via camada `dataClient` (Fase 1 da arquitetura
 * desacoplada). O backend aplica idempotência baseada em `input.client_uuid`:
 * reenvio com o mesmo UUID retorna o ID da venda existente sem duplicar
 * venda, itens, baixa de estoque, pagamentos, lançamento financeiro ou
 * movimento de caixa.
 *
 * Cabe ao chamador (PDV) preencher `client_uuid` e mantê-lo estável durante
 * toda a vida do carrinho.
 */
export function useFinalizarVendaPDV() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FinalizarVendaInput) => dataClient.vendas.finalizar(input),
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
  caixa_id: string | null;
  operador_id: string | null;
  terminal_id: string | null;
}

export function useVendas() {
  return useQuery({
    queryKey: ["vendas", "list"],
    queryFn: async (): Promise<VendaListItem[]> => {
      const { data, error } = await supabase
        .from("vendas")
        .select(
          "id, numero, cliente_id, data_emissao, data_finalizacao, total, status, status_pagamento, forma_pagamento, caixa_id, operador_id, terminal_id, cliente:clientes(nome)",
        )
        .order("created_at", { ascending: false })
        .limit(500);
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
        caixa_id: v.caixa_id ?? null,
        operador_id: v.operador_id ?? null,
        terminal_id: v.terminal_id ?? null,
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
  /** Soma dos pagamentos efetivos (lançamentos financeiros) */
  valor_pago_total: number;
  /** Saldo restante = total - valor_pago_total */
  valor_restante: number;
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
  pagamentos: Array<{
    id: string;
    forma_pagamento: FormaPagamento;
    valor: number;
    valor_recebido: number | null;
    troco: number | null;
    parcelas: number | null;
    observacao: string | null;
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

      const { data: pagamentos, error: e3 } = await supabase
        .from("venda_pagamentos")
        .select(
          "id, forma_pagamento, valor, valor_recebido, troco, parcelas, observacao",
        )
        .eq("venda_id", vendaId)
        .order("created_at", { ascending: true });
      if (e3) throw e3;

      // Soma de pagamentos efetivos via lançamentos financeiros vinculados
      const { data: lancs } = await supabase
        .from("financeiro_lancamentos")
        .select("valor_pago, status")
        .eq("venda_id", vendaId);
      const valor_pago_total = (lancs ?? [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((l: any) => l.status !== "cancelado")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .reduce((s: number, l: any) => s + (Number(l.valor_pago) || 0), 0);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vAny = v as any;
      const total = Number(vAny.total) || 0;
      return {
        id: vAny.id,
        numero: vAny.numero,
        cliente_nome: vAny.cliente?.nome ?? null,
        data_emissao: vAny.data_emissao,
        data_finalizacao: vAny.data_finalizacao,
        subtotal: Number(vAny.subtotal) || 0,
        desconto: Number(vAny.desconto) || 0,
        total,
        valor_recebido: vAny.valor_recebido,
        troco: vAny.troco,
        valor_pago_total,
        valor_restante: Math.max(0, total - valor_pago_total),
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pagamentos: (pagamentos ?? []).map((p: any) => ({
          id: p.id,
          forma_pagamento: p.forma_pagamento,
          valor: Number(p.valor) || 0,
          valor_recebido: p.valor_recebido != null ? Number(p.valor_recebido) : null,
          troco: p.troco != null ? Number(p.troco) : null,
          parcelas: p.parcelas != null ? Number(p.parcelas) : null,
          observacao: p.observacao,
        })),
      };
    },
  });
}

// =============== Histórico de status da venda ===============
export interface VendaStatusHistoricoItem {
  id: string;
  status_anterior: string | null;
  status_novo: string;
  origem: "financeiro" | "vendas" | "sistema";
  alterado_por: string | null;
  motivo: string | null;
  created_at: string;
}

export function useVendaStatusHistorico(vendaId: string | null) {
  return useQuery({
    queryKey: ["vendas", "historico", vendaId],
    enabled: !!vendaId,
    queryFn: async (): Promise<VendaStatusHistoricoItem[]> => {
      if (!vendaId) return [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("vendas_status_historico")
        .select("id, status_anterior, status_novo, origem, alterado_por, motivo, created_at")
        .eq("venda_id", vendaId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []) as VendaStatusHistoricoItem[];
    },
  });
}

// =============== Alterar status da venda ===============
export type StatusVendaEditavel =
  | "pago"
  | "pendente"
  | "parcial"
  | "cancelado"
  | "vencido";

export function useAlterarStatusVenda() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      venda_id: string;
      novo_status: StatusVendaEditavel;
      motivo?: string | null;
    }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("alterar_status_venda", {
        _venda_id: input.venda_id,
        _novo_status: input.novo_status,
        _motivo: input.motivo ?? null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendas"] });
      qc.invalidateQueries({ queryKey: ["financeiro"] });
      qc.invalidateQueries({ queryKey: ["financeiro-indicadores"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Status da venda atualizado");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// =============== Cancelar venda (estorno) ===============
// `CancelarVendaResumo` agora vive em `@/integrations/data` e é re-exportado
// no topo deste arquivo para compatibilidade.

// =============== Métricas do dia / período ===============
export interface VendaMetricas {
  qtd_vendas: number;
  qtd_canceladas: number;
  total_vendido: number;
  ticket_medio: number;
  qtd_pendentes: number;
  valor_pendente: number;
}

export function useVendaMetricasPeriodo(dataInicio: string, dataFim: string) {
  return useQuery({
    queryKey: ["vendas", "metricas", dataInicio, dataFim],
    queryFn: async (): Promise<VendaMetricas> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("venda_metricas_periodo", {
        _data_inicio: dataInicio,
        _data_fim: dataFim,
      });
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = (data ?? {}) as any;
      return {
        qtd_vendas: Number(d.qtd_vendas) || 0,
        qtd_canceladas: Number(d.qtd_canceladas) || 0,
        total_vendido: Number(d.total_vendido) || 0,
        ticket_medio: Number(d.ticket_medio) || 0,
        qtd_pendentes: Number(d.qtd_pendentes) || 0,
        valor_pendente: Number(d.valor_pendente) || 0,
      };
    },
  });
}

export function useExcluirVendaCancelada() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (venda_id: string) => dataClient.vendas.excluirCancelada(venda_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendas"] });
      qc.invalidateQueries({ queryKey: ["financeiro"] });
      qc.invalidateQueries({ queryKey: ["movimentacoes"] });
      toast.success("Venda excluída com sucesso");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCancelarVenda() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { venda_id: string; motivo?: string | null }) =>
      dataClient.vendas.cancelar(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendas"] });
      qc.invalidateQueries({ queryKey: ["estoque-saldos"] });
      qc.invalidateQueries({ queryKey: ["movimentacoes"] });
      qc.invalidateQueries({ queryKey: ["financeiro"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
