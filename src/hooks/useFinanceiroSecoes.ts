import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/auth/AuthProvider";
import { dataClient } from "@/integrations/data";
import { computePeriodo, type PeriodoRange } from "@/lib/dateRange";
import type { SecaoFiltroValue, FormaFiltro } from "@/components/financeiro/SecaoFiltro";
import type {
  PerformancePeriodoDomain,
  PosicaoFinanceiraDomain,
  ReceberOrigemDomain,
} from "@/integrations/data/extra-types";

function toRange(v: SecaoFiltroValue): PeriodoRange {
  return computePeriodo(v.preset, v.custom);
}

// ============ Posição financeira (a receber / a pagar / saldo) ============

export interface PosicaoFinanceiraData extends PosicaoFinanceiraDomain {
  periodo: PeriodoRange;
}

export function usePosicaoFinanceira(filtro: SecaoFiltroValue) {
  const periodo = toRange(filtro);
  const { user } = useAuth();
  return useQuery({
    queryKey: ["fin_posicao", user?.id, periodo.inicio, periodo.fim],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async (): Promise<PosicaoFinanceiraData> => {
      const data = await dataClient.financeiro.posicaoPeriodo({
        inicio: periodo.inicio,
        fim: periodo.fim,
        inicioTs: periodo.inicioTs,
        fimTs: periodo.fimTs,
      });
      if (import.meta.env.DEV) {
        console.debug("[DASH_AUDIT] fin.posicaoPeriodo", {
          owner_id: user?.id, periodo, data,
        });
      }
      return { ...data, periodo };
    },
  });
}

// ============ Performance (vendido / custo / lucro) ============

export interface PerformanceData extends PerformancePeriodoDomain {
  periodo: PeriodoRange;
}

export function usePerformancePeriodo(filtro: SecaoFiltroValue) {
  const periodo = toRange(filtro);
  const { user } = useAuth();
  return useQuery({
    queryKey: ["fin_performance", user?.id, periodo.inicio, periodo.fim],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async (): Promise<PerformanceData> => {
      const data = await dataClient.financeiro.performancePeriodo({
        inicio: periodo.inicio,
        fim: periodo.fim,
        inicioTs: periodo.inicioTs,
        fimTs: periodo.fimTs,
      });
      if (import.meta.env.DEV) {
        console.debug("[DASH_AUDIT] fin.performancePeriodo", {
          owner_id: user?.id, periodo, data,
        });
      }
      return { ...data, periodo };
    },
  });
}

// ============ A receber por origem e operacional ============

export interface ReceberOrigemData extends ReceberOrigemDomain {
  periodo: PeriodoRange;
  forma: FormaFiltro;
}

export function useReceberOrigem(filtro: SecaoFiltroValue) {
  const periodo = toRange(filtro);
  const forma: FormaFiltro = filtro.forma ?? "todos";
  return useQuery({
    queryKey: ["fin_receber_origem", periodo.inicio, periodo.fim, forma],
    staleTime: 30_000,
    queryFn: async (): Promise<ReceberOrigemData> => {
      const data = await dataClient.financeiro.receberOrigem({
        periodo: {
          inicio: periodo.inicio,
          fim: periodo.fim,
          inicioTs: periodo.inicioTs,
          fimTs: periodo.fimTs,
        },
        forma,
      });
      return { ...data, periodo, forma };
    },
  });
}
