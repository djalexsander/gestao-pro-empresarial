import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CobrancaPendenteItem = {
  tipo: "plano" | "modulo";
  plano_id: string | null;
  modulo_id: string | null;
  descricao: string | null;
  valor: number;
};

export type CobrancaPendente = {
  pagamento_id: string;
  valor: number;
  descricao: string | null;
  data_vencimento: string | null;
  asaas_payment_id: string | null;
  invoice_url: string | null;
  pix_qrcode: string | null;
  pix_copia_cola: string | null;
  created_at: string;
  itens: CobrancaPendenteItem[];
};

/**
 * Retorna a cobrança Pix pendente da empresa do usuário (se houver),
 * com QR Code e copia-e-cola já preenchidos para retomar o checkout.
 */
export function useCobrancaPendente(enabled = true) {
  return useQuery({
    queryKey: ["cobranca-pendente"],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<CobrancaPendente | null> => {
      const { data, error } = await (supabase.rpc as any)(
        "cobranca_pendente_atual",
      );
      if (error) throw error;
      return (data ?? null) as CobrancaPendente | null;
    },
  });
}
