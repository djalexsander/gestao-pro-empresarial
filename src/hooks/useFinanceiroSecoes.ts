import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { computePeriodo, type PeriodoRange } from "@/lib/dateRange";
import type { SecaoFiltroValue, FormaFiltro } from "@/components/financeiro/SecaoFiltro";
import {
  fetchLocalFinanceiroJson,
  isFinanceiroLocalDesktopMode,
  localLancamentoStatus,
  localLancamentoTipo,
  type LocalFinanceiroLancamento,
} from "@/lib/financeiro-local";

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
      if (isFinanceiroLocalDesktopMode()) {
        const { desde_ms, ate_ms } = periodoMs(periodo);
        const rows = await fetchLocalFinanceiroJson<LocalFinanceiroLancamento[]>(
          "/api/financeiro/lancamentos",
          { desde_ms, ate_ms, limit: 5000 },
        );
        let totalReceber = 0;
        let qtdReceber = 0;
        let totalPagar = 0;
        let qtdPagar = 0;
        for (const l of rows) {
          const aberto = abertoLocal(l);
          if (aberto <= 0) continue;
          if (localLancamentoTipo(l) === "receber") {
            totalReceber += aberto;
            qtdReceber += 1;
          } else {
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
      }

      const { data, error } = await supabase
        .from("financeiro_lancamentos")
        .select("id, tipo, valor, valor_pago, status, data_vencimento")
        .gte("data_vencimento", periodo.inicio)
        .lte("data_vencimento", periodo.fim)
        .neq("status", "cancelado")
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
      }>) {
        if (l.status === "pago" || l.status === "recebido") continue;
        const aberto = (Number(l.valor) || 0) - (Number(l.valor_pago) || 0);
        if (aberto <= 0) continue;
        if (l.tipo === "receber") {
          totalReceber += aberto;
          qtdReceber += 1;
        } else if (l.tipo === "pagar") {
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

function abertoLocal(l: LocalFinanceiroLancamento) {
  const status = localLancamentoStatus(l);
  if (status === "pago" || status === "recebido" || status === "cancelado") return 0;
  return Math.max(0, Number(l.valor) || 0);
}

function matchFormaLocal(formaFiltro: FormaFiltro, lanc: string | null): boolean {
  if (formaFiltro === "todos") return true;
  return lanc === formaFiltro;
}

export function usePerformancePeriodo(filtro: SecaoFiltroValue) {
  const periodo = toRange(filtro);
  return useQuery({
    queryKey: ["fin_performance", periodo.inicio, periodo.fim],
    staleTime: 30_000,
    queryFn: async (): Promise<PerformanceData> => {
      if (isFinanceiroLocalDesktopMode()) {
        return {
          indisponivel: true,
          indisponivelMotivo:
            "Dados locais de itens de venda e custo ainda nao disponiveis para lucro bruto.",
          totalVendido: 0,
          qtdVendas: 0,
          custoTotal: 0,
          qtdItens: 0,
          qtdItensSemCusto: 0,
          lucroBruto: 0,
          margemPct: 0,
          periodo,
        };
      }

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
      if (isFinanceiroLocalDesktopMode()) {
        const { desde_ms, ate_ms } = periodoMs(periodo);
        const periodoRows = await fetchLocalFinanceiroJson<LocalFinanceiroLancamento[]>("/api/financeiro/lancamentos", {
          desde_ms,
          ate_ms,
          limit: 5000,
        });
        const todosRows = await fetchLocalFinanceiroJson<LocalFinanceiroLancamento[]>("/api/financeiro/lancamentos", {
          limit: 5000,
        });
        const hoje = new Date().toISOString().slice(0, 10);
        let fiadoEmAberto = 0;
        let qtdFiado = 0;
        let ifoodAReceber = 0;
        let qtdIfood = 0;
        let recebidoPeriodo = 0;
        let qtdRecebimentos = 0;
        let vencidosTotal = 0;
        let qtdVencidos = 0;

        for (const l of todosRows) {
          if (localLancamentoTipo(l) !== "receber") continue;
          if (!matchFormaLocal(forma, l.forma_pagamento)) continue;
          const aberto = abertoLocal(l);
          if (aberto > 0 && l.forma_pagamento === "fiado") {
            fiadoEmAberto += aberto;
            qtdFiado += 1;
          } else if (aberto > 0 && l.forma_pagamento === "ifood") {
            ifoodAReceber += aberto;
            qtdIfood += 1;
          }
          const venc = l.data_vencimento_ms ? new Date(l.data_vencimento_ms).toISOString().slice(0, 10) : null;
          if (aberto > 0 && venc && venc < hoje && venc >= periodo.inicio && venc <= periodo.fim) {
            vencidosTotal += aberto;
            qtdVencidos += 1;
          }
        }

        for (const l of periodoRows) {
          if (localLancamentoTipo(l) !== "receber") continue;
          if (!matchFormaLocal(forma, l.forma_pagamento)) continue;
          const status = localLancamentoStatus(l);
          if (status !== "pago" && status !== "recebido") continue;
          recebidoPeriodo += Number(l.valor) || 0;
          qtdRecebimentos += 1;
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
      }
      // Em aberto (fiado / ifood) — pendentes não conciliados
      const { data: abertos } = await supabase
        .from("financeiro_lancamentos")
        .select("valor, valor_pago, forma_pagamento, conciliado_em, status")
        .eq("tipo", "receber")
        .in("status", ["pendente"])
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
      }>) {
        if (l.conciliado_em) continue;
        if (!matchForma(forma, l.forma_pagamento)) continue;
        const aberto = (Number(l.valor) || 0) - (Number(l.valor_pago) || 0);
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
        .select("valor, valor_pago, forma_pagamento")
        .eq("tipo", "receber")
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
      }>) {
        if (!matchForma(forma, l.forma_pagamento)) continue;
        recebidoPeriodo += Number(l.valor_pago ?? l.valor) || 0;
        qtdRecebimentos += 1;
      }

      // Vencidos (a receber, vencimento dentro do período escolhido)
      const hoje = new Date().toISOString().slice(0, 10);
      const { data: vencidos } = await supabase
        .from("financeiro_lancamentos")
        .select("valor, valor_pago, forma_pagamento")
        .eq("tipo", "receber")
        .in("status", ["pendente"])
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
      }>) {
        if (!matchForma(forma, l.forma_pagamento)) continue;
        const aberto = (Number(l.valor) || 0) - (Number(l.valor_pago) || 0);
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
