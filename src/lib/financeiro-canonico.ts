/**
 * Fonte canônica de regras financeiras (Dashboard, Financeiro, Relatórios, DRE,
 * Fluxo de Caixa, Produtos Vendidos).
 *
 * Objetivo: garantir que todas as telas usem a MESMA fórmula para os mesmos
 * indicadores. NÃO altera regra contábil — apenas centraliza o que já estava
 * espalhado nos hooks/rotas.
 *
 * Regras (acordadas no PROMPT 16):
 *  - "Total vendido" considera apenas vendas com status válido (não cancelada),
 *    no campo `data_finalizacao` (data em que a venda foi concluída).
 *  - Custo dos produtos vendidos usa `produtos.preco_custo` * quantidade.
 *    Obs: `venda_itens` ainda não persiste custo no momento da venda; quando
 *    essa coluna existir, este módulo deve passar a preferi-la.
 *  - Lucro bruto = Total vendido - Custo dos produtos vendidos.
 *  - Margem bruta = Lucro / Total vendido (0 quando vendas = 0).
 *  - Lançamentos financeiros aceitam tipos legados (`receita`/`despesa`) e
 *    atuais (`receber`/`pagar`).
 *  - "Realizado" = status `pago` ou `recebido` (entrada de caixa efetiva).
 *  - "Pendente" = status `pendente`, `parcial` ou `vencido` (NÃO entra como
 *    dinheiro realizado, apenas como recebível/pagável).
 *  - Em recebimento parcial, a entrada realizada é apenas `valor_pago`.
 *  - Em lançamentos a receber conciliados (ex.: iFood), a diferença
 *    `valor - valor_pago` é taxa, não pendência.
 */

// ============ Tipos ============

export type LancamentoTipo = "receita" | "despesa" | "receber" | "pagar";
export type LancamentoStatus =
  | "pendente"
  | "pago"
  | "recebido"
  | "vencido"
  | "cancelado"
  | "parcial";

export interface LancamentoCanonico {
  tipo?: LancamentoTipo | string | null;
  status?: LancamentoStatus | string | null;
  valor: number | string | null;
  valor_pago?: number | string | null;
  conciliado_em?: string | null;
  forma_pagamento?: string | null;
  data_pagamento?: string | null;
  data_vencimento?: string | null;
}

// ============ Constantes ============

/** Status de venda que NÃO contam como receita. */
export const VENDA_STATUS_EXCLUIDOS = ["cancelada"] as const;

/** Campo canônico para data de venda concluída. */
export const VENDA_DATA_CAMPO = "data_finalizacao" as const;

const TIPOS_RECEBER = new Set<string>(["receber", "receita"]);
const TIPOS_PAGAR = new Set<string>(["pagar", "despesa"]);
const STATUS_REALIZADO = new Set<string>(["pago", "recebido"]);
const STATUS_PENDENTE = new Set<string>(["pendente", "parcial", "vencido"]);
const STATUS_CANCELADO = new Set<string>(["cancelado"]);

// ============ Helpers de classificação ============

export const isLancReceber = (l: Pick<LancamentoCanonico, "tipo">) =>
  TIPOS_RECEBER.has(String(l.tipo ?? ""));

export const isLancPagar = (l: Pick<LancamentoCanonico, "tipo">) =>
  TIPOS_PAGAR.has(String(l.tipo ?? ""));

export const isLancRealizado = (l: Pick<LancamentoCanonico, "status">) =>
  STATUS_REALIZADO.has(String(l.status ?? ""));

export const isLancPendente = (l: Pick<LancamentoCanonico, "status">) =>
  STATUS_PENDENTE.has(String(l.status ?? ""));

export const isLancCancelado = (l: Pick<LancamentoCanonico, "status">) =>
  STATUS_CANCELADO.has(String(l.status ?? ""));

// ============ Cálculos ============

const num = (v: unknown) => Number(v ?? 0) || 0;

/** Valor em aberto de um lançamento (valor - valor_pago, nunca negativo). */
export function calcAbertoLanc(l: LancamentoCanonico): number {
  return Math.max(0, num(l.valor) - num(l.valor_pago));
}

/** Valor realizado/efetivado (valor_pago se houver, senão valor). */
export function calcValorRealizado(l: LancamentoCanonico): number {
  const pago = num(l.valor_pago);
  return pago > 0 ? pago : num(l.valor);
}

/**
 * Soma "a receber" canônica para lançamentos a receber em aberto.
 * Ignora cancelados e cancelados/realizados. Para conciliados (ex.: iFood já
 * recebido), considera 0 pendência (diferença é taxa).
 */
export function somarReceberEmAberto(lancs: LancamentoCanonico[]): number {
  let total = 0;
  for (const l of lancs) {
    if (!isLancReceber(l)) continue;
    if (isLancCancelado(l) || isLancRealizado(l)) continue;
    if (l.conciliado_em) continue;
    total += calcAbertoLanc(l);
  }
  return total;
}

/** Soma "a pagar" canônica para lançamentos a pagar em aberto. */
export function somarPagarEmAberto(lancs: LancamentoCanonico[]): number {
  let total = 0;
  for (const l of lancs) {
    if (!isLancPagar(l)) continue;
    if (isLancCancelado(l) || isLancRealizado(l)) continue;
    total += calcAbertoLanc(l);
  }
  return total;
}

/** Lucro bruto canônico. */
export const calcLucroBruto = (totalVendido: number, custoTotal: number) =>
  num(totalVendido) - num(custoTotal);

/** Margem bruta percentual (0..100). */
export const calcMargemPct = (totalVendido: number, lucroBruto: number) =>
  num(totalVendido) > 0 ? (num(lucroBruto) / num(totalVendido)) * 100 : 0;

/** Custo de um item de venda. Usa custo do item quando existir, senão
 *  `produtos.preco_custo`. */
export function calcCustoItem(item: {
  quantidade: number | string | null;
  preco_custo_item?: number | string | null;
  preco_custo_produto?: number | string | null;
}): number {
  const qtd = num(item.quantidade);
  const custo =
    item.preco_custo_item != null && num(item.preco_custo_item) > 0
      ? num(item.preco_custo_item)
      : num(item.preco_custo_produto);
  return qtd * custo;
}
