import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";

export type MovimentacaoTipo = "entrada" | "saida" | "ajuste" | "devolucao" | "transferencia";

export type Movimentacao = {
  id: string;
  produto_id: string;
  variacao_id: string | null;
  tipo: MovimentacaoTipo;
  origem: string;
  quantidade: number;
  custo_unitario: number | null;
  saldo_anterior: number | null;
  saldo_posterior: number | null;
  observacoes: string | null;
  data_movimentacao: string;
};

/**
 * Calcula saldo agregado por produto a partir das movimentações.
 * Faz uma única query e agrega no cliente — eficiente para o número
 * típico de movimentações de cada usuário e evita N chamadas RPC.
 */
export function useEstoqueSaldos() {
  return useQuery({
    queryKey: ["estoque-saldos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("estoque_movimentacoes")
        .select("produto_id, variacao_id, tipo, quantidade");
      if (error) throw error;

      const map = new Map<string, number>();
      for (const m of data ?? []) {
        const key = m.produto_id;
        const sinal =
          m.tipo === "entrada" || m.tipo === "devolucao"
            ? 1
            : m.tipo === "saida" || m.tipo === "transferencia"
              ? -1
              : 1; // ajuste pode vir negativo na quantidade
        map.set(key, (map.get(key) ?? 0) + sinal * Number(m.quantidade));
      }
      return map;
    },
  });
}

export function useMovimentacoes(produtoId?: string) {
  return useQuery({
    queryKey: ["movimentacoes", produtoId ?? "all"],
    queryFn: async () => {
      let q = supabase
        .from("estoque_movimentacoes")
        .select("*, produto:produtos(id, sku, nome)")
        .order("data_movimentacao", { ascending: false })
        .limit(200);
      if (produtoId) q = q.eq("produto_id", produtoId);
      const { data, error } = await q;
      if (error) throw error;
      return data as Array<
        Movimentacao & { produto: { id: string; sku: string; nome: string } | null }
      >;
    },
  });
}

export function useCriarMovimentacao() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      produto_id: string;
      variacao_id?: string | null;
      tipo: MovimentacaoTipo;
      quantidade: number; // sempre positivo; sinal vem do tipo
      custo_unitario?: number | null;
      observacoes?: string | null;
      origem?: string;
      saldo_atual: number; // saldo conhecido para gravar histórico e validar
    }) => {
      if (!user) throw new Error("Não autenticado");
      if (input.quantidade <= 0) throw new Error("Quantidade deve ser maior que zero.");

      const delta =
        input.tipo === "entrada" || input.tipo === "devolucao"
          ? input.quantidade
          : input.tipo === "saida" || input.tipo === "transferencia"
            ? -input.quantidade
            : input.quantidade;

      const novoSaldo = input.saldo_atual + delta;
      if (novoSaldo < 0) {
        throw new Error(
          `Estoque insuficiente. Saldo atual: ${input.saldo_atual}. Saída solicitada: ${input.quantidade}.`
        );
      }

      const { data, error } = await supabase
        .from("estoque_movimentacoes")
        .insert({
          owner_id: user.id,
          produto_id: input.produto_id,
          variacao_id: input.variacao_id ?? null,
          tipo: input.tipo,
          origem: (input.origem ?? "ajuste_manual") as
            | "compra" | "venda" | "ajuste_manual" | "devolucao_cliente"
            | "devolucao_fornecedor" | "inventario" | "outro",
          quantidade: input.quantidade,
          custo_unitario: input.custo_unitario ?? null,
          saldo_anterior: input.saldo_atual,
          saldo_posterior: novoSaldo,
          observacoes: input.observacoes ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["estoque-saldos"] });
      qc.invalidateQueries({ queryKey: ["movimentacoes"] });
      toast.success("Movimentação registrada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
