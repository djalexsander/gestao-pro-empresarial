/**
 * useLotes — leitura/escrita de lotes de produto (Bloco 14).
 *
 * Leitura: view `lotes_produto_com_saldo` (saldo recalculado a partir de
 * `estoque_movimentacoes` + classificação de validade).
 *
 * Mutations: delegadas a `dataClient.lotes` (cloud-ready, idempotentes).
 *
 * Padrão alinhado com `useClientes`/`useFornecedores`/`useFuncionarios`:
 *   - 1 `client_uuid` por mutation (retries reusam a mesma chave),
 *   - invalida `["lotes"]` (lista) e `["lotes", produto_id]` (filtro
 *     por produto) — UI futura pode usar a chave que preferir,
 *   - mensagens de erro vêm prontas das RPCs.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { dataClient } from "@/integrations/data";
import type {
  AjustarQuantidadeLoteInput,
  CriarLoteProdutoInput,
  EditarLoteProdutoInput,
} from "@/integrations/data";

export type StatusValidade = "vencido" | "critico" | "alerta" | "ok" | null;

export type LoteComSaldo = {
  id: string;
  owner_id: string;
  produto_id: string;
  variacao_id: string | null;
  numero_lote: string;
  data_fabricacao: string | null;
  data_validade: string | null;
  quantidade_inicial: number;
  quantidade_atual: number;
  custo_unitario: number | null;
  observacoes: string | null;
  created_at: string;
  updated_at: string;
  produto_nome: string;
  produto_sku: string;
  variacao_nome: string | null;
  saldo_real: number;
  status_validade: StatusValidade;
};

/**
 * Lista lotes via view `lotes_produto_com_saldo`.
 * Filtros opcionais: por produto, por validade (não vencidos), e ordenação
 * padrão por validade ascendente (vencidos/críticos primeiro).
 */
export function useLotes(filtros?: { produto_id?: string; somente_com_saldo?: boolean }) {
  const produtoId = filtros?.produto_id ?? null;
  const somenteComSaldo = filtros?.somente_com_saldo ?? false;

  return useQuery({
    queryKey: ["lotes", produtoId, somenteComSaldo],
    queryFn: () =>
      dataClient.lotes.list({
        produto_id: produtoId,
        somente_com_saldo: somenteComSaldo,
      }) as Promise<LoteComSaldo[]>,
  });
}

/** Cria lote (idempotente via client_uuid). */
export function useCreateLote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<CriarLoteProdutoInput, "client_uuid">) => {
      const client_uuid = crypto.randomUUID();
      return dataClient.lotes.criar({ ...input, client_uuid });
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["lotes"] });
      qc.invalidateQueries({ queryKey: ["lotes", variables.produto_id] });
      // Saldo de produto pode mudar (se registrar_entrada=true).
      qc.invalidateQueries({ queryKey: ["estoque"] });
      qc.invalidateQueries({ queryKey: ["produtos"] });
      toast.success("Lote criado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Edita lote. Banco bloqueia mudar produto_id, e variação/qtd inicial após movimentos. */
export function useUpdateLote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: EditarLoteProdutoInput) => dataClient.lotes.editar(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lotes"] });
      toast.success("Lote atualizado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * Ajusta quantidade do lote (gera estoque_movimentacao tipo `ajuste`).
 * Única forma segura de mexer em saldo após existir movimento.
 */
export function useAjustarQuantidadeLote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<AjustarQuantidadeLoteInput, "client_uuid">) => {
      const client_uuid = crypto.randomUUID();
      return dataClient.lotes.ajustarQuantidade({ ...input, client_uuid });
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["lotes"] });
      qc.invalidateQueries({ queryKey: ["estoque"] });
      qc.invalidateQueries({ queryKey: ["produtos"] });
      if (data.sem_diferenca) {
        toast.info("Saldo já estava na quantidade informada.");
      } else if (data.idempotente) {
        toast.info("Ajuste já registrado.");
      } else {
        toast.success("Saldo do lote ajustado.");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Hard delete. Bloqueado se houver movimentações/compras/vendas vinculadas. */
export function useDeleteLote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (loteId: string) => dataClient.lotes.excluir(loteId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lotes"] });
      toast.success("Lote excluído.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
