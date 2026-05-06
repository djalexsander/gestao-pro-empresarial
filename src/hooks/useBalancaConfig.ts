import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dataClient } from "@/integrations/data";
import { useAuth } from "@/components/auth/AuthProvider";
import { DEFAULT_BALANCA_CONFIG, type BalancaConfig } from "@/lib/balanca";

export type BalancaConfigRow = BalancaConfig & {
  owner_id: string;
  observacoes: string | null;
  updated_at: string;
};

const QK = ["balanca-config"];

/**
 * Busca a configuração da balança do owner atual. Retorna o default se não existir.
 */
export function useBalancaConfig() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...QK, user?.id ?? "anon"],
    enabled: !!user,
    queryFn: async (): Promise<BalancaConfigRow> => {
      const data = await dataClient.balanca.obter(user!.id);
      if (!data) {
        return {
          ...DEFAULT_BALANCA_CONFIG,
          owner_id: user!.id,
          observacoes: null,
          updated_at: new Date().toISOString(),
        };
      }
      return data as unknown as BalancaConfigRow;
    },
    staleTime: 60_000,
  });
}

export function useSaveBalancaConfig() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: Partial<BalancaConfigRow>) => {
      if (!user) throw new Error("Não autenticado");
      const saved = await dataClient.balanca.salvar({ ...input, owner_id: user.id });
      return saved as unknown as BalancaConfigRow;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK });
      toast.success("Configuração da balança salva.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Versão "leve" usada pelo PDV — síncrona após o cache estar quente. */
export function useBalancaConfigCached(): BalancaConfig {
  const { data } = useBalancaConfig();
  return data ?? { ...DEFAULT_BALANCA_CONFIG };
}
