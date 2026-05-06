import { useQuery } from "@tanstack/react-query";
import { dataClient } from "@/integrations/data";
import type {
  FinanceiroIndicadoresMesDomain,
  FinanceiroPeriodoDomain,
  FinanceiroVendaItemDetalheDomain,
  FinanceiroVendaResumoDomain,
} from "@/integrations/data/extra-types";

export type FinanceiroPeriodo = FinanceiroPeriodoDomain;
export type VendaItemDetalhe = FinanceiroVendaItemDetalheDomain;
export type VendaResumoDetalhe = FinanceiroVendaResumoDomain;
export type FinanceiroIndicadores = FinanceiroIndicadoresMesDomain;

export function getMesAtual(): FinanceiroPeriodo {
  const today = new Date();
  const inicio = new Date(today.getFullYear(), today.getMonth(), 1);
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const inicioStr = ymd(inicio);
  const fimStr = ymd(today);
  return {
    inicio: inicioStr,
    fim: fimStr,
    inicioTs: `${inicioStr}T00:00:00`,
    fimTs: `${fimStr}T23:59:59.999`,
    hoje: fimStr,
  };
}

export function useFinanceiroIndicadores() {
  return useQuery({
    queryKey: ["financeiro_indicadores_mes"],
    queryFn: () => dataClient.financeiro.indicadoresMes(),
    staleTime: 30_000,
  });
}
