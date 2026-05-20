import type { FormaPagamento, VendaFinanceiraInput } from "./types";
import { calcularRateio, ratearPorForma } from "./financeEngine";
import { round2 } from "./taxas";

export interface FluxoSaidaInput {
  tipo: "compra" | "despesa" | "sangria" | "taxa" | "reembolso" | "outro";
  valor: number;
  descricao?: string;
}

export interface FluxoCaixaResultado {
  entradas_operacionais: {
    total: number;
    por_forma: Partial<Record<FormaPagamento, number>>;
  };
  entradas_previstas: {
    total: number;
    fiado: number;
    cartao_futuro: number;
    boletos: number;
    outros: number;
  };
  saidas: {
    total: number;
    compras: number;
    despesas: number;
    sangrias: number;
    taxas: number;
    reembolsos: number;
    outros: number;
  };
  liquido: number; // entradas_operacionais − saidas
}

/**
 * Separa Entradas Operacionais (recebido), Entradas Previstas (a receber)
 * e Saídas. As entradas operacionais agrupam por forma de pagamento.
 *
 * Cartão de crédito vai para "cartao_futuro" se ainda não liquidado,
 * mas como por enquanto não modelamos liquidação separada, toda venda em
 * crédito já recebida (valor_pago > 0) entra como operacional. Saldo
 * restante de fiado entra como previsto.
 */
export function montarFluxoCaixa(
  vendas: VendaFinanceiraInput[],
  saidas: FluxoSaidaInput[] = [],
): FluxoCaixaResultado {
  const por_forma: Partial<Record<FormaPagamento, number>> = {};
  let entradas_op = 0;
  let fiado = 0;
  let cartao_futuro = 0;
  let boletos = 0;
  let outros_previstos = 0;

  for (const v of vendas) {
    const r = calcularRateio(v);
    const partes = ratearPorForma(v, r);
    for (const p of partes) {
      por_forma[p.pagamento.forma] = round2(
        (por_forma[p.pagamento.forma] ?? 0) + p.pagamento.valor,
      );
      entradas_op += p.pagamento.valor;
    }

    // Saldo restante = previsto
    if (r.saldo_restante > 0) {
      // heurística: se há pagamento em "fiado" ou nenhum pagamento -> fiado
      const formas = new Set(partes.map((p) => p.pagamento.forma));
      if (formas.has("fiado") || formas.size === 0) fiado += r.saldo_restante;
      else if (formas.has("credito")) cartao_futuro += r.saldo_restante;
      else if (formas.has("boleto")) boletos += r.saldo_restante;
      else outros_previstos += r.saldo_restante;
    }
  }

  const saidas_agg = {
    compras: 0,
    despesas: 0,
    sangrias: 0,
    taxas: 0,
    reembolsos: 0,
    outros: 0,
    total: 0,
  };
  for (const s of saidas) {
    const v = Math.max(0, Number(s.valor) || 0);
    saidas_agg.total += v;
    switch (s.tipo) {
      case "compra":
        saidas_agg.compras += v;
        break;
      case "despesa":
        saidas_agg.despesas += v;
        break;
      case "sangria":
        saidas_agg.sangrias += v;
        break;
      case "taxa":
        saidas_agg.taxas += v;
        break;
      case "reembolso":
        saidas_agg.reembolsos += v;
        break;
      default:
        saidas_agg.outros += v;
    }
  }

  const out: FluxoCaixaResultado = {
    entradas_operacionais: { total: round2(entradas_op), por_forma },
    entradas_previstas: {
      total: round2(fiado + cartao_futuro + boletos + outros_previstos),
      fiado: round2(fiado),
      cartao_futuro: round2(cartao_futuro),
      boletos: round2(boletos),
      outros: round2(outros_previstos),
    },
    saidas: {
      total: round2(saidas_agg.total),
      compras: round2(saidas_agg.compras),
      despesas: round2(saidas_agg.despesas),
      sangrias: round2(saidas_agg.sangrias),
      taxas: round2(saidas_agg.taxas),
      reembolsos: round2(saidas_agg.reembolsos),
      outros: round2(saidas_agg.outros),
    },
    liquido: round2(entradas_op - saidas_agg.total),
  };

  return out;
}
