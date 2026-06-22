import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { computePeriodo, type PeriodoRange } from "@/lib/dateRange";
import type { SecaoFiltroValue, FormaFiltro } from "@/components/financeiro/SecaoFiltro";
import {
  calcAbertoLanc,
  calcValorRealizado,
  isLancCancelado,
  isLancPagar,
  isLancRealizado,
  isLancReceber,
} from "@/lib/financeiro-canonico";
// Local desktop finance helpers are intentionally not used for cloud-only reports.

function toRange(v: SecaoFiltroValue): PeriodoRange {
  return computePeriodo(v.preset, v.custom);
}

// ============ Posição financeira (a receber / a pagar / saldo) ============

export interface PosicaoFinanceiraData {
  totalReceber: number;
  qtdReceber: number;
  totalPagar: number;
  qtdPagar: number;
  saldo: number;
  periodo: PeriodoRange;
}

export function usePosicaoFinanceira(filtro: SecaoFiltroValue) {
  const periodo = toRange(filtro);
  return useQuery({
    queryKey: ["fin_posicao", periodo.inicio, periodo.fim],
    staleTime: 30_000,
    queryFn: async (): Promise<PosicaoFinanceiraData> => {
      const { data, error } = await supabase
        .from("financeiro_lancamentos")
        .select("id, tipo, valor, valor_pago, status, data_vencimento, conciliado_em")
        .gte("data_vencimento", periodo.inicio)
        .lte("data_vencimento", periodo.fim)
        .limit(5000);
      if (error) throw error;

      let totalReceber = 0;
      let qtdReceber = 0;
      let totalPagar = 0;
      let qtdPagar = 0;
      for (const l of (data ?? []) as Array<{
        tipo: string;
        valor: number;
        valor_pago: number | null;
        status: string;
        conciliado_em: string | null;
      }>) {
        if (isLancCancelado(l) || isLancRealizado(l)) continue;
        const aberto = calcAbertoLanc(l);
        if (aberto <= 0) continue;
        if (isLancReceber(l)) {
          if (l.conciliado_em) continue;
          totalReceber += aberto;
          qtdReceber += 1;
        } else if (isLancPagar(l)) {
          totalPagar += aberto;
          qtdPagar += 1;
        }
      }
      return {
        totalReceber,
        qtdReceber,
        totalPagar,
        qtdPagar,
        saldo: totalReceber - totalPagar,
        periodo,
      };
    },
  });
}

// ============ Performance (vendido / custo / lucro) ============

export interface PerformanceData {
  indisponivel?: boolean;
  indisponivelMotivo?: string;
  totalVendido: number;
  qtdVendas: number;
  custoTotal: number;
  qtdItens: number;
  qtdItensSemCusto: number;
  lucroBruto: number;
  margemPct: number;
  periodo: PeriodoRange;
}

function periodoMs(periodo: PeriodoRange) {
  return {
    desde_ms: new Date(`${periodo.inicio}T00:00:00`).getTime(),
    ate_ms: new Date(`${periodo.fim}T23:59:59.999`).getTime(),
  };
}

// local helpers removed; use Supabase as canonical source for reports

export function usePerformancePeriodo(filtro: SecaoFiltroValue) {
  const periodo = toRange(filtro);
  return useQuery({
    queryKey: ["fin_performance", periodo.inicio, periodo.fim],
    staleTime: 30_000,
    queryFn: async (): Promise<PerformanceData> => {
      const { data: vendasData, error } = await supabase
        .from("vendas")
        .select("id, total")
        .gte("data_finalizacao", periodo.inicioTs)
        .lte("data_finalizacao", periodo.fimTs)
        .neq("status", "cancelada")
        .limit(5000);
      if (error) throw error;

      const vendas = (vendasData ?? []) as Array<{ id: string; total: number }>;
      const totalVendido = vendas.reduce((s, v) => s + (Number(v.total) || 0), 0);

      let custoTotal = 0;
      let qtdItens = 0;
      let qtdItensSemCusto = 0;
      const ids = vendas.map((v) => v.id);
      if (ids.length > 0) {
        const { data: itens } = await supabase
          .from("venda_itens")
          .select("quantidade, total, produto:produtos(preco_custo)")
          .in("venda_id", ids)
          .limit(20000);
        for (const it of (itens ?? []) as Array<{
          quantidade: number;
          total: number;
          produto: { preco_custo: number | null } | null;
        }>) {
          const qtd = Number(it.quantidade) || 0;
          const pc = Number(it.produto?.preco_custo ?? 0) || 0;
          qtdItens += 1;
          if (pc <= 0) qtdItensSemCusto += 1;
          custoTotal += pc * qtd;
        }
      }
      const lucroBruto = totalVendido - custoTotal;
      const margemPct = totalVendido > 0 ? (lucroBruto / totalVendido) * 100 : 0;
      return {
        totalVendido,
        qtdVendas: vendas.length,
        custoTotal,
        qtdItens,
        qtdItensSemCusto,
        lucroBruto,
        margemPct,
        periodo,
      };
    },
  });
}

// ============ A receber por origem e operacional ============

export interface ReceberOrigemData {
  fiadoEmAberto: number;
  qtdFiado: number;
  ifoodAReceber: number;
  qtdIfood: number;
  recebidoPeriodo: number;
  qtdRecebimentos: number;
  vencidosTotal: number;
  qtdVencidos: number;
  periodo: PeriodoRange;
  forma: FormaFiltro;
}

function matchForma(formaFiltro: FormaFiltro, lanc: string | null): boolean {
  if (formaFiltro === "todos") return true;
  return lanc === formaFiltro;
}

export function useReceberOrigem(filtro: SecaoFiltroValue) {
  const periodo = toRange(filtro);
  const forma: FormaFiltro = filtro.forma ?? "todos";
  return useQuery({
    queryKey: ["fin_receber_origem", periodo.inicio, periodo.fim, forma],
    staleTime: 30_000,
    queryFn: async (): Promise<ReceberOrigemData> => {
      const { data: abertos } = await supabase
        .from("financeiro_lancamentos")
        .select("valor, valor_pago, forma_pagamento, conciliado_em, status, tipo")
        .in("tipo", ["receber", "receita"])
        .limit(5000);

      let fiadoEmAberto = 0;
      let qtdFiado = 0;
      let ifoodAReceber = 0;
      let qtdIfood = 0;
      for (const l of (abertos ?? []) as Array<{
        valor: number;
        valor_pago: number | null;
        forma_pagamento: string | null;
        conciliado_em: string | null;
        status: string;
        tipo: string;
      }>) {
        if (isLancCancelado(l) || isLancRealizado(l)) continue;
        if (l.conciliado_em) continue;
        if (!matchForma(forma, l.forma_pagamento)) continue;
        const aberto = calcAbertoLanc(l);
        if (aberto <= 0) continue;
        if (l.forma_pagamento === "fiado") {
          fiadoEmAberto += aberto;
          qtdFiado += 1;
        } else if (l.forma_pagamento === "ifood") {
          ifoodAReceber += aberto;
          qtdIfood += 1;
        }
      }

      // Recebido no período
      const { data: pagos } = await supabase
        .from("financeiro_lancamentos")
        .select("valor, valor_pago, forma_pagamento, tipo, status")
        .in("tipo", ["receber", "receita"])
        .in("status", ["pago", "recebido"])
        .gte("data_pagamento", periodo.inicio)
        .lte("data_pagamento", periodo.fim)
        .limit(5000);

      let recebidoPeriodo = 0;
      let qtdRecebimentos = 0;
      for (const l of (pagos ?? []) as Array<{
        valor: number;
        valor_pago: number | null;
        forma_pagamento: string | null;
        tipo: string;
        status: string;
      }>) {
        if (!matchForma(forma, l.forma_pagamento)) continue;
        recebidoPeriodo += calcValorRealizado(l);
        qtdRecebimentos += 1;
      }

      // Vencidos (a receber, vencimento dentro do período escolhido)
      const hoje = new Date().toISOString().slice(0, 10);
      const { data: vencidos } = await supabase
        .from("financeiro_lancamentos")
        .select("valor, valor_pago, forma_pagamento, tipo, status")
        .in("tipo", ["receber", "receita"])
        .in("status", ["pendente", "parcial", "vencido"])
        .gte("data_vencimento", periodo.inicio)
        .lte("data_vencimento", periodo.fim < hoje ? periodo.fim : hoje)
        .lt("data_vencimento", hoje)
        .limit(5000);

      let vencidosTotal = 0;
      let qtdVencidos = 0;
      for (const l of (vencidos ?? []) as Array<{
        valor: number;
        valor_pago: number | null;
        forma_pagamento: string | null;
        tipo: string;
        status: string;
      }>) {
        if (!matchForma(forma, l.forma_pagamento)) continue;
        const aberto = calcAbertoLanc(l);
        if (aberto > 0) {
          vencidosTotal += aberto;
          qtdVencidos += 1;
        }
      }

      return {
        fiadoEmAberto,
        qtdFiado,
        ifoodAReceber,
        qtdIfood,
        recebidoPeriodo,
        qtdRecebimentos,
        vencidosTotal,
        qtdVencidos,
        periodo,
        forma,
      };
    },
  });
}
