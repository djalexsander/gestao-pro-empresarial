import type { FormaPagamento } from "./types";

/**
 * Taxas padrão por forma de pagamento (em fração: 0.05 = 5%).
 * Valores conservadores de mercado; podem ser sobrescritos por configuração
 * da empresa no futuro (config_comercial ou tabela própria).
 */
export const TAXAS_PADRAO: Record<FormaPagamento, number> = {
  dinheiro: 0,
  pix: 0,
  debito: 0.0199, // ~1.99%
  credito: 0.0349, // ~3.49% à vista
  fiado: 0,
  ifood: 0.23, // comissão média iFood (sem entrega)
  boleto: 0.0,
  voucher: 0.04,
  outro: 0,
};

export function taxaPercentual(forma: FormaPagamento, override?: number): number {
  if (typeof override === "number" && override >= 0) return override;
  return TAXAS_PADRAO[forma] ?? 0;
}

export function calcularTaxa(
  forma: FormaPagamento,
  valor: number,
  taxa_valor_explicita?: number,
  taxa_percentual_override?: number,
): number {
  if (typeof taxa_valor_explicita === "number") return round2(taxa_valor_explicita);
  return round2(valor * taxaPercentual(forma, taxa_percentual_override));
}

export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
