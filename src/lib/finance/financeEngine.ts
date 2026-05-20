/**
 * Motor financeiro puro — rateio proporcional, lucro/custo realizado,
 * resultado real. Sem efeitos colaterais, sem I/O.
 */
import type {
  PagamentoInput,
  RateioProporcional,
  VendaFinanceiraInput,
} from "./types";
import { round2 } from "./taxas";

const DEV = typeof import.meta !== "undefined" && (import.meta as any).env?.DEV;

function devLog(tag: string, payload: unknown) {
  if (!DEV) return;
  // eslint-disable-next-line no-console
  console.log(tag, payload);
}

/**
 * Calcula o rateio proporcional de uma venda baseado no que JÁ foi recebido.
 *
 * percentual_recebido = clamp(valor_pago / valor_total, 0, 1)
 * custo_realizado     = custo_total × percentual_recebido
 * lucro_realizado     = (valor_total − custo_total) × percentual_recebido
 */
export function calcularRateio(venda: VendaFinanceiraInput): RateioProporcional {
  const valor_total = Math.max(0, Number(venda.valor_total) || 0);
  const custo_total = Math.max(0, Number(venda.custo_total) || 0);
  const valor_pago = Math.max(0, Math.min(valor_total, Number(venda.valor_pago) || 0));

  const percentual_recebido = valor_total > 0 ? valor_pago / valor_total : 0;
  const lucro_total = valor_total - custo_total;

  const custo_realizado = round2(custo_total * percentual_recebido);
  const lucro_realizado = round2(lucro_total * percentual_recebido);
  const custo_pendente = round2(custo_total - custo_realizado);
  const lucro_pendente = round2(lucro_total - lucro_realizado);
  const saldo_restante = round2(valor_total - valor_pago);

  const out: RateioProporcional = {
    venda_id: venda.venda_id,
    valor_total: round2(valor_total),
    valor_pago: round2(valor_pago),
    percentual_recebido,
    custo_total: round2(custo_total),
    custo_realizado,
    custo_pendente,
    lucro_total: round2(lucro_total),
    lucro_realizado,
    lucro_pendente,
    saldo_restante,
  };

  devLog("[FINANCE_ENGINE]", out);
  devLog("[CUSTO_PROPORCIONAL]", {
    venda_id: out.venda_id,
    custo_total: out.custo_total,
    custo_realizado,
    custo_pendente,
    percentual_recebido,
  });
  devLog("[LUCRO_PROPORCIONAL]", {
    venda_id: out.venda_id,
    lucro_total: out.lucro_total,
    lucro_realizado,
    lucro_pendente,
    percentual_recebido,
  });

  return out;
}

/**
 * Rateia o custo/lucro realizado proporcionalmente entre as formas
 * de pagamento que efetivamente compuseram o recebido.
 *
 * Útil para o card "Vendas por forma de pagamento" quando a venda é mista.
 */
export interface RateioPorForma {
  pagamento: PagamentoInput;
  participacao: number; // 0..1 do total pago
  custo_realizado: number;
  lucro_realizado: number;
}

export function ratearPorForma(
  venda: VendaFinanceiraInput,
  rateio = calcularRateio(venda),
): RateioPorForma[] {
  const pagamentos = (venda.pagamentos ?? []).filter((p) => (Number(p.valor) || 0) > 0);
  if (pagamentos.length === 0) return [];

  const totalPago = pagamentos.reduce((s, p) => s + (Number(p.valor) || 0), 0);
  if (totalPago <= 0) return [];

  return pagamentos.map((p) => {
    const participacao = (Number(p.valor) || 0) / totalPago;
    return {
      pagamento: p,
      participacao,
      custo_realizado: round2(rateio.custo_realizado * participacao),
      lucro_realizado: round2(rateio.lucro_realizado * participacao),
    };
  });
}
