/**
 * Motor financeiro — tipos puros.
 * Nenhum import de Supabase/SQLite aqui: tudo é orientado a valores.
 */

export type FormaPagamento =
  | "dinheiro"
  | "pix"
  | "debito"
  | "credito"
  | "fiado"
  | "ifood"
  | "boleto"
  | "voucher"
  | "outro";

/** Linha mínima de uma venda para cálculo financeiro. */
export interface VendaFinanceiraInput {
  venda_id: string;
  /** Valor bruto vendido (após desconto/acrescimo aplicados na venda). */
  valor_total: number;
  /** Soma do custo dos itens (custo médio × quantidade). */
  custo_total: number;
  /** Total efetivamente recebido até agora. */
  valor_pago: number;
  /** Pagamentos parciais já registrados (para rateio por forma). */
  pagamentos?: PagamentoInput[];
}

export interface PagamentoInput {
  pagamento_id?: string;
  forma: FormaPagamento;
  valor: number;
  /** Taxa absoluta já conhecida (R$). Se ausente, usa tabela de taxas. */
  taxa_valor?: number;
  data?: string; // ISO
}

/**
 * Resultado do rateio proporcional de uma venda.
 * Todos os valores em R$, com 2 casas (arredondamento "banker-safe" — half-up).
 */
export interface RateioProporcional {
  venda_id: string;
  valor_total: number;
  valor_pago: number;
  /** 0..1 */
  percentual_recebido: number;
  custo_total: number;
  custo_realizado: number;
  custo_pendente: number;
  lucro_total: number;
  lucro_realizado: number;
  lucro_pendente: number;
  saldo_restante: number;
}

export interface LinhaFormaPagamento {
  forma: FormaPagamento;
  qtd_vendas: number;
  total_vendido: number;
  total_recebido: number;
  total_pendente: number;
  custo_realizado: number;
  lucro_bruto: number; // recebido − custo
  taxa: number;
  lucro_liquido: number; // recebido − custo − taxa
  ticket_medio: number;
}

export interface ResultadoReal {
  receita_bruta: number;
  receita_liquida: number; // recebido − taxas
  recebido: number;
  previsto: number; // vendido − recebido
  pendente: number;
  custos_realizados: number;
  custos_pendentes: number;
  taxas: number;
  despesas: number;
  lucro_bruto: number; // vendido − custo total
  lucro_liquido: number; // recebido − custos_realizados − taxas − despesas
  resultado_operacional_real: number; // = lucro_liquido
}
