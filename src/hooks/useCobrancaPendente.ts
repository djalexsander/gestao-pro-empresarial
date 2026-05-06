import { useQuery } from "@tanstack/react-query";
import { dataClient } from "@/integrations/data";
import type {
  CobrancaPendenteDomain,
  CobrancaPendenteItemDomain,
} from "@/integrations/data/extra-types";

export type CobrancaPendenteItem = CobrancaPendenteItemDomain;
export type CobrancaPendente = CobrancaPendenteDomain;

/**
 * Retorna a cobrança Pix pendente da empresa do usuário (se houver),
 * com QR Code e copia-e-cola já preenchidos para retomar o checkout.
 */
export function useCobrancaPendente(enabled = true) {
  return useQuery({
    queryKey: ["cobranca-pendente"],
    enabled,
    staleTime: 30_000,
    queryFn: () => dataClient.financeiro.cobrancaPendente(),
  });
}
