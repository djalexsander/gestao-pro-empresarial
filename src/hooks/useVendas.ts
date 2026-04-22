import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type FormaPagamento =
  | "dinheiro"
  | "pix"
  | "cartao_debito"
  | "cartao_credito"
  | "boleto"
  | "transferencia"
  | "cheque"
  | "outro";

export type StatusPagamento = "pago" | "pendente" | "parcial" | "cancelado";

export interface FinalizarVendaItem {
  produto_id: string;
  quantidade: number;
  preco_unitario: number;
  desconto: number;
  descricao?: string | null;
}

export interface FinalizarVendaInput {
  cliente_id: string | null;
  subtotal: number;
  desconto: number;
  total: number;
  forma_pagamento: FormaPagamento;
  status_pagamento: StatusPagamento;
  valor_recebido: number | null;
  troco: number | null;
  observacao: string | null;
  itens: FinalizarVendaItem[];
  gerar_financeiro?: boolean;
}

export function useFinalizarVendaPDV() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: FinalizarVendaInput) => {
      // RPC ainda não está nos types gerados.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("finalizar_venda_pdv", {
        _cliente_id: input.cliente_id,
        _subtotal: input.subtotal,
        _desconto: input.desconto,
        _total: input.total,
        _forma: input.forma_pagamento,
        _status_pagamento: input.status_pagamento,
        _valor_recebido: input.valor_recebido,
        _troco: input.troco,
        _observacao: input.observacao,
        _itens: input.itens,
        _gerar_financeiro: input.gerar_financeiro ?? true,
      });
      if (error) throw error;
      return data as string; // venda_id
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendas"] });
      qc.invalidateQueries({ queryKey: ["estoque-saldos"] });
      qc.invalidateQueries({ queryKey: ["movimentacoes"] });
      qc.invalidateQueries({ queryKey: ["financeiro"] });
      toast.success("Venda finalizada com sucesso!");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
