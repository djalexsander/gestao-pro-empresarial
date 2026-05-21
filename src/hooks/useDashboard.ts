import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/auth/AuthProvider";
import { dataClient } from "@/integrations/data";
import type { DashboardData } from "@/integrations/data/extra-types";

export type { DashboardData };

const EMPTY_DASHBOARD: DashboardData = {
  vendasMes: 0,
  vendasMesAnterior: 0,
  comprasMes: 0,
  comprasMesAnterior: 0,
  lucroMes: 0,
  margem: 0,
  contasPagar: 0,
  qtdContasPagar: 0,
  contasReceber: 0,
  qtdContasReceber: 0,
  estoqueBaixo: 0,
  vendasPorMes: [],
  fluxoCaixa: [],
  ultimasVendas: [],
  ultimasCompras: [],
};

/**
 * Onda 1 (offline-first): consome `dataClient.dashboard.carregar()` em vez
 * de chamar Supabase direto. Toda agregação fica no adapter e pode ser
 * trocada por uma fonte local sem mexer aqui.
 */
export function useDashboard() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["dashboard", user?.id],
    enabled: !!user,
    refetchInterval: 60_000,
    queryFn: async () => {
      let data: DashboardData | null = null;
      try {
        data = await dataClient.dashboard.carregar();
      } catch (error) {
        console.warn("[DASHBOARD_FALLBACK] falha ao carregar dashboard; usando fallback local vazio", error);
      }
      if (import.meta.env.DEV) {
        console.debug("[DASH_AUDIT] dashboard.carregar", {
          owner_id: user?.id,
          data,
        });
      }
      return data ?? EMPTY_DASHBOARD;
    },
  });
}
