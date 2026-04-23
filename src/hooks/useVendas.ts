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

export interface FinalizarVendaPagamento {
  forma_pagamento: FormaPagamento;
  valor: number;
  valor_recebido?: number | null;
  troco?: number | null;
  parcelas?: number | null;
  observacao?: string | null;
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
  /** Múltiplas formas de pagamento. Se vazio, usa forma_pagamento como única. */
  pagamentos?: FinalizarVendaPagamento[];
  gerar_financeiro?: boolean;
  /** ID do funcionário operador que está realizando a venda. */
  operador_id?: string | null;
  /** ID do terminal físico (PDV) onde a venda ocorreu. */
  terminal_id?: string | null;
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
        _pagamentos: input.pagamentos && input.pagamentos.length > 0 ? input.pagamentos : null,
        _gerar_financeiro: input.gerar_financeiro ?? true,
        _operador_id: input.operador_id ?? null,
        _terminal_id: input.terminal_id ?? null,
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

// =============== Cancelar venda (estorno) ===============
export interface CancelarVendaResumo {
  venda_id: string;
  numero: string;
  total: number;
  motivo: string | null;
  cancelado_em: string;
  qtd_itens_estornados: number;
  qtd_total_estornada: number;
  itens_estornados: Array<{
    produto_id: string;
    produto_nome: string;
    quantidade: number;
    saldo_anterior: number;
    saldo_posterior: number;
    valor_total: number;
  }>;
  qtd_lancamentos_cancelados: number;
  total_lancamentos_cancelados: number;
  lancamentos_cancelados: Array<{
    id: string;
    descricao: string;
    valor: number;
    valor_pago: number;
    tipo: string;
    status_anterior: string;
  }>;
}

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
    mutationFn: async (venda_id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("excluir_venda_cancelada", {
        _venda_id: venda_id,
      });
      if (error) throw error;
      return data;
    },
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
    mutationFn: async ({
      venda_id,
      motivo,
    }: {
      venda_id: string;
      motivo?: string | null;
    }): Promise<CancelarVendaResumo> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("cancelar_venda", {
        _venda_id: venda_id,
        _motivo: motivo ?? null,
      });
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = data as any;
      return {
        venda_id: d.venda_id,
        numero: d.numero,
        total: Number(d.total) || 0,
        motivo: d.motivo ?? null,
        cancelado_em: d.cancelado_em,
        qtd_itens_estornados: Number(d.qtd_itens_estornados) || 0,
        qtd_total_estornada: Number(d.qtd_total_estornada) || 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        itens_estornados: (d.itens_estornados ?? []).map((i: any) => ({
          produto_id: i.produto_id,
          produto_nome: i.produto_nome,
          quantidade: Number(i.quantidade) || 0,
          saldo_anterior: Number(i.saldo_anterior) || 0,
          saldo_posterior: Number(i.saldo_posterior) || 0,
          valor_total: Number(i.valor_total) || 0,
        })),
        qtd_lancamentos_cancelados: Number(d.qtd_lancamentos_cancelados) || 0,
        total_lancamentos_cancelados: Number(d.total_lancamentos_cancelados) || 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lancamentos_cancelados: (d.lancamentos_cancelados ?? []).map((l: any) => ({
          id: l.id,
          descricao: l.descricao,
          valor: Number(l.valor) || 0,
          valor_pago: Number(l.valor_pago) || 0,
          tipo: l.tipo,
          status_anterior: l.status_anterior,
        })),
      };
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
