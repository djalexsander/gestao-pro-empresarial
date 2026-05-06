import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/auth/AuthProvider";
import { dataClient } from "@/integrations/data";
import type { DashboardData } from "@/integrations/data/extra-types";

export type { DashboardData };

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
    queryFn: () => dataClient.dashboard.carregar(),
  });
}
