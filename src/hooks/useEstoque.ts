import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/components/auth/AuthProvider";
import { dataClient } from "@/integrations/data";
import type {
  MovimentacaoEstoqueTipo,
  RegistrarMovimentoEstoqueInput,
  RegistrarMovimentoEstoqueResult,
} from "@/integrations/data";

/**
 * Mantido por compatibilidade com componentes que importam daqui.
 * A fonte da verdade do tipo está em `@/integrations/data`.
 */
export type MovimentacaoTipo = MovimentacaoEstoqueTipo;

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
      const linhas = await dataClient.estoque.saldosLinhas();
      const map = new Map<string, number>();
      for (const m of linhas) {
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
      const data = await dataClient.estoque.movimentacoes({
        produto_id: produtoId ?? null,
      });
      return data as Array<
        Movimentacao & { produto: { id: string; sku: string; nome: string } | null }
      >;
    },
  });
}

/**
 * Registra movimentação manual de estoque via `dataClient.estoque`.
 *
 * Toda a regra (cálculo de saldo, lock por produto, validação de saldo
 * negativo, idempotência) acontece no banco. O hook só repassa o input.
 *
 * IMPORTANTE: o componente chamador DEVE gerar e manter um `client_uuid`
 * estável enquanto o modal estiver aberto, para garantir idempotência
 * contra duplo clique, Enter repetido e retry de rede.
 */
export function useCriarMovimentacao() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation<
    RegistrarMovimentoEstoqueResult,
    Error,
    Omit<RegistrarMovimentoEstoqueInput, "origem"> & {
      origem?: RegistrarMovimentoEstoqueInput["origem"];
      /** mantido por compat: o saldo é recalculado server-side e ignorado aqui */
      saldo_atual?: number;
    },
    { saldoSnaps: Array<[readonly unknown[], Map<string, number> | undefined]> }
  >({
    mutationFn: async (input) => {
      if (!user) throw new Error("Não autenticado");
      if (!input.quantidade || input.quantidade <= 0) {
        throw new Error("Quantidade deve ser maior que zero.");
      }
      return dataClient.estoque.registrarMovimento({
        produto_id: input.produto_id,
        variacao_id: input.variacao_id ?? null,
        tipo: input.tipo,
        quantidade: input.quantidade,
        custo_unitario: input.custo_unitario ?? null,
        observacoes: input.observacoes ?? null,
        origem: input.origem ?? "ajuste_manual",
        client_uuid: input.client_uuid ?? null,
      });
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["estoque-saldos"] });
      const saldoSnaps = qc.getQueriesData<Map<string, number>>({ queryKey: ["estoque-saldos"] });
      const sinal =
        input.tipo === "entrada" || input.tipo === "devolucao"
          ? 1
          : input.tipo === "saida" || input.tipo === "transferencia"
            ? -1
            : 1;
      const delta = sinal * Number(input.quantidade);
      saldoSnaps.forEach(([key, prev]) => {
        if (!(prev instanceof Map)) return;
        const next = new Map(prev);
        next.set(input.produto_id, (next.get(input.produto_id) ?? 0) + delta);
        qc.setQueryData<Map<string, number>>(key, next);
      });
      return { saldoSnaps };
    },
    onError: (e: Error, _v, ctx) => {
      ctx?.saldoSnaps?.forEach(([k, v]) => qc.setQueryData(k, v));
      toast.error(e.message);
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["estoque-saldos"] });
      qc.invalidateQueries({ queryKey: ["movimentacoes"] });
      qc.invalidateQueries({ queryKey: ["produtos"] });
      if (result.idempotente) {
        toast.success("Movimentação já registrada (reenvio idempotente).");
      } else {
        toast.success("Movimentação registrada.");
      }
    },
  });
}
