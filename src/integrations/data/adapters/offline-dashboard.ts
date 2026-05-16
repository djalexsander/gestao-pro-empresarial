/**
 * ============================================================================
 * offline-dashboard — Cálculo do Dashboard a partir de fontes locais
 * ============================================================================
 *
 * ETAPA 13 — Dashboard / Relatórios 100% offline-first.
 *
 * Função pura usada por `local-server` e `local-terminal` para construir o
 * `DashboardData` a partir dos arrays crus já entregues por
 * `/api/vendas/historico`, `/api/compras`, `/api/financeiro/lancamentos-completo`,
 * `/api/produtos/list` e `/api/estoque/saldos`.
 *
 * Regras críticas (preservadas):
 *   1. Vendas canceladas NÃO entram no faturamento nem no lucro.
 *   2. Lançamentos pendentes/atrasados NÃO entram no fluxo de caixa do mês
 *      como entrada/saída realizada — só somam em contasPagar / contasReceber.
 *   3. Margem é calculada apenas quando `vendasMes > 0`.
 *
 * Aditivo: a função não toca rede, não toca Supabase, e pode ser reusada
 * por qualquer adapter offline.
 */

import type { DashboardData } from "../extra-types";

const MESES = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

interface VendaRaw {
  id: string;
  numero: string;
  cliente_id: string | null;
  cliente?: { nome?: string | null } | null;
  cliente_nome?: string | null;
  total: number | string | null;
  status: string;
  data_emissao: string;
}

interface CompraRaw {
  id: string;
  numero: string;
  fornecedor_id: string | null;
  fornecedor?: {
    razao_social?: string | null;
    nome_fantasia?: string | null;
  } | null;
  total: number | string | null;
  status: string;
  data_emissao: string;
}

interface LancamentoRaw {
  tipo: string;
  valor: number | string | null;
  valor_pago: number | string | null;
  status: string;
  data_pagamento: string | null;
}

interface ProdutoRaw {
  id: string;
  estoque_minimo: number | string | null;
  status: string;
}

interface SaldoLinhaRaw {
  produto_id: string;
  tipo: string;
  quantidade: number | string;
}

export function buildDashboardFromRaw(input: {
  vendas: unknown;
  compras: unknown;
  lancamentos: unknown;
  produtos: unknown;
  saldos: unknown;
}): DashboardData | null {
  const { vendas: vRaw, compras: cRaw, lancamentos: lRaw, produtos: pRaw, saldos: sRaw } = input;
  if (
    !Array.isArray(vRaw) ||
    !Array.isArray(cRaw) ||
    !Array.isArray(lRaw) ||
    !Array.isArray(pRaw) ||
    !Array.isArray(sRaw)
  ) {
    return null;
  }

  const hoje = new Date();
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const inicioMesAnt = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  const inicio6Meses = new Date(hoje.getFullYear(), hoje.getMonth() - 5, 1);

  const vendas = (vRaw as VendaRaw[]).filter((v) => {
    if (v.status === "cancelada") return false;
    const d = new Date(v.data_emissao);
    return d >= inicio6Meses;
  });

  const compras = (cRaw as CompraRaw[]).filter((c) => {
    const d = new Date(c.data_emissao);
    return d >= inicio6Meses;
  });

  const sumIf = <T extends { data_emissao: string; total: number | string | null }>(
    arr: T[],
    from: Date,
    to?: Date,
  ) =>
    arr
      .filter((x) => {
        const d = new Date(x.data_emissao);
        return d >= from && (!to || d < to);
      })
      .reduce((s, x) => s + Number(x.total ?? 0), 0);

  const vendasMes = sumIf(vendas, inicioMes);
  const vendasMesAnterior = sumIf(vendas, inicioMesAnt, inicioMes);
  const comprasMes = sumIf(compras, inicioMes);
  const comprasMesAnterior = sumIf(compras, inicioMesAnt, inicioMes);
  const lucroMes = vendasMes - comprasMes;
  const margem = vendasMes > 0 ? (lucroMes / vendasMes) * 100 : 0;

  const seriesMap = new Map<string, { vendas: number; compras: number }>();
  for (let i = 0; i < 6; i++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - 5 + i, 1);
    seriesMap.set(`${d.getFullYear()}-${d.getMonth()}`, { vendas: 0, compras: 0 });
  }
  for (const v of vendas) {
    const d = new Date(v.data_emissao);
    const ref = seriesMap.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (ref) ref.vendas += Number(v.total ?? 0);
  }
  for (const c of compras) {
    const d = new Date(c.data_emissao);
    const ref = seriesMap.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (ref) ref.compras += Number(c.total ?? 0);
  }
  const vendasPorMes = Array.from(seriesMap.entries()).map(([key, val]) => {
    const [, m] = key.split("-").map(Number);
    return { month: MESES[m], vendas: val.vendas, compras: val.compras };
  });

  // Pendentes / atrasados NÃO contam como entrada realizada — só saldos em aberto.
  const lancamentos = lRaw as LancamentoRaw[];
  const contasPagarLancs = lancamentos.filter(
    (l) => l.tipo === "despesa" && l.status !== "pago" && l.status !== "cancelado",
  );
  const contasReceberLancs = lancamentos.filter(
    (l) => l.tipo === "receita" && l.status !== "pago" && l.status !== "cancelado",
  );
  const contasPagar = contasPagarLancs.reduce(
    (s, l) => s + (Number(l.valor) - Number(l.valor_pago ?? 0)),
    0,
  );
  const contasReceber = contasReceberLancs.reduce(
    (s, l) => s + (Number(l.valor) - Number(l.valor_pago ?? 0)),
    0,
  );

  // Fluxo de caixa do mês: só conta o que foi efetivamente pago (com data_pagamento).
  const fluxoMap = new Map<number, { entrada: number; saida: number }>();
  const diasNoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
  for (let d = 1; d <= diasNoMes; d++) fluxoMap.set(d, { entrada: 0, saida: 0 });
  for (const l of lancamentos) {
    if (!l.data_pagamento) continue;
    const dp = new Date(l.data_pagamento);
    if (dp < inicioMes) continue;
    const ref = fluxoMap.get(dp.getDate());
    if (!ref) continue;
    if (l.tipo === "receita") ref.entrada += Number(l.valor_pago ?? 0);
    else if (l.tipo === "despesa") ref.saida += Number(l.valor_pago ?? 0);
  }
  const fluxoCaixa = Array.from(fluxoMap.entries()).map(([dia, val]) => ({
    day: String(dia).padStart(2, "0"),
    entrada: val.entrada,
    saida: val.saida,
  }));

  const produtosBaixo = (pRaw as ProdutoRaw[]).filter(
    (p) => p.status === "ativo" && Number(p.estoque_minimo ?? 0) > 0,
  );
  const saldos = new Map<string, number>();
  for (const m of sRaw as SaldoLinhaRaw[]) {
    const sinal =
      m.tipo === "entrada" || m.tipo === "devolucao"
        ? 1
        : m.tipo === "saida" || m.tipo === "transferencia"
          ? -1
          : 1;
    saldos.set(m.produto_id, (saldos.get(m.produto_id) ?? 0) + sinal * Number(m.quantidade));
  }
  let estoqueBaixo = 0;
  for (const p of produtosBaixo) {
    const saldo = saldos.get(p.id) ?? 0;
    if (saldo <= Number(p.estoque_minimo)) estoqueBaixo++;
  }

  const ultimasVendas = vendas.slice(0, 5).map((v) => ({
    id: v.id,
    numero: v.numero,
    cliente:
      v.cliente?.nome ??
      v.cliente_nome ??
      (v.cliente_id ? "—" : "Consumidor"),
    valor: Number(v.total ?? 0),
    status: v.status,
    data: v.data_emissao,
  }));
  const ultimasCompras = compras.slice(0, 5).map((c) => ({
    id: c.id,
    numero: c.numero,
    fornecedor:
      c.fornecedor?.nome_fantasia ?? c.fornecedor?.razao_social ?? "—",
    valor: Number(c.total ?? 0),
    status: c.status,
    data: c.data_emissao,
  }));

  return {
    vendasMes,
    vendasMesAnterior,
    comprasMes,
    comprasMesAnterior,
    lucroMes,
    margem,
    contasPagar,
    qtdContasPagar: contasPagarLancs.length,
    contasReceber,
    qtdContasReceber: contasReceberLancs.length,
    estoqueBaixo,
    vendasPorMes,
    fluxoCaixa,
    ultimasVendas,
    ultimasCompras,
  };
}
