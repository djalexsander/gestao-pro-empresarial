import type { ResultadoReal, VendaFinanceiraInput } from "./types";
import { calcularRateio, ratearPorForma } from "./financeEngine";
import { calcularTaxa, round2 } from "./taxas";

const DEV = typeof import.meta !== "undefined" && (import.meta as any).env?.DEV;

export interface ResultadoRealInput {
  vendas: VendaFinanceiraInput[];
  /** Despesas operacionais já pagas no período (saídas de financeiro). */
  despesas?: number;
}

/**
 * Calcula o resultado operacional real do período.
 *
 * RESULTADO_REAL = receita_liquida − custos_realizados − despesas
 *   onde receita_liquida = recebido − taxas
 *
 * Lucro bruto = vendido − custo total
 * Lucro líquido = receita_liquida − custos_realizados − despesas
 */
export function calcularResultadoReal({
  vendas,
  despesas = 0,
}: ResultadoRealInput): ResultadoReal {
  let receita_bruta = 0;
  let recebido = 0;
  let custos_realizados = 0;
  let custos_pendentes = 0;
  let custo_total_geral = 0;
  let taxas = 0;

  for (const v of vendas) {
    const r = calcularRateio(v);
    receita_bruta += r.valor_total;
    recebido += r.valor_pago;
    custos_realizados += r.custo_realizado;
    custos_pendentes += r.custo_pendente;
    custo_total_geral += r.custo_total;

    for (const rp of ratearPorForma(v, r)) {
      taxas += calcularTaxa(rp.pagamento.forma, rp.pagamento.valor, rp.pagamento.taxa_valor);
    }
  }

  const previsto = round2(receita_bruta - recebido);
  const pendente = previsto;
  const receita_liquida = round2(recebido - taxas);
  const lucro_bruto = round2(receita_bruta - custo_total_geral);
  const lucro_liquido = round2(receita_liquida - custos_realizados - despesas);

  const out: ResultadoReal = {
    receita_bruta: round2(receita_bruta),
    receita_liquida,
    recebido: round2(recebido),
    previsto,
    pendente,
    custos_realizados: round2(custos_realizados),
    custos_pendentes: round2(custos_pendentes),
    taxas: round2(taxas),
    despesas: round2(despesas),
    lucro_bruto,
    lucro_liquido,
    resultado_operacional_real: lucro_liquido,
  };

  if (DEV) {
    // eslint-disable-next-line no-console
    console.log("[RESULTADO_REAL]", out);
  }
  return out;
}
