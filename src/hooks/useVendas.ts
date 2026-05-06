import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dataClient } from "@/integrations/data";
import type {
  CancelarVendaResumo as DataCancelarVendaResumo,
  FinalizarVendaInput as DataFinalizarVendaInput,
  FinalizarVendaItem as DataFinalizarVendaItem,
  FinalizarVendaPagamento as DataFinalizarVendaPagamento,
  FormaPagamento as DataFormaPagamento,
  StatusPagamento as DataStatusPagamento,
} from "@/integrations/data";
import type {
  VendaDetalheDomain,
  VendaListItemDomain,
  VendaMetricasDomain,
  VendaStatusHistoricoDomain,
} from "@/integrations/data/extra-types";

// Re-exports
export type FormaPagamento = DataFormaPagamento;
export type StatusPagamento = DataStatusPagamento;
export type FinalizarVendaItem = DataFinalizarVendaItem;
export type FinalizarVendaPagamento = DataFinalizarVendaPagamento;
export type FinalizarVendaInput = DataFinalizarVendaInput;
export type CancelarVendaResumo = DataCancelarVendaResumo;

export type VendaStatus =
  | "rascunho"
  | "aprovada"
  | "faturada"
  | "cancelada"
  | string;

export type VendaListItem = VendaListItemDomain;
export type VendaDetalhe = VendaDetalheDomain;
export type VendaStatusHistoricoItem = VendaStatusHistoricoDomain;
export type VendaMetricas = VendaMetricasDomain;

export function useFinalizarVendaPDV() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FinalizarVendaInput) => dataClient.vendas.finalizar(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendas"] });
      qc.invalidateQueries({ queryKey: ["estoque-saldos"] });
      qc.invalidateQueries({ queryKey: ["movimentacoes"] });
      qc.invalidateQueries({ queryKey: ["financeiro"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSaldosLote() {
  return useMutation({
    mutationFn: (produtoIds: string[]) => dataClient.estoque.saldosLote(produtoIds),
  });
}

export function useVendas() {
  return useQuery({
    queryKey: ["vendas", "list"],
    queryFn: () => dataClient.vendas.list(),
  });
}

export function useVendaDetalhe(vendaId: string | null) {
  return useQuery({
    queryKey: ["vendas", "detalhe", vendaId],
    enabled: !!vendaId,
    queryFn: () => (vendaId ? dataClient.vendas.detalhe(vendaId) : null),
  });
}

export function useVendaStatusHistorico(vendaId: string | null) {
  return useQuery({
    queryKey: ["vendas", "historico", vendaId],
    enabled: !!vendaId,
    queryFn: () => (vendaId ? dataClient.vendas.historico(vendaId) : []),
  });
}

export type StatusVendaEditavel =
  | "pago"
  | "pendente"
  | "parcial"
  | "cancelado"
  | "vencido";

export function useAlterarStatusVenda() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      venda_id: string;
      novo_status: StatusVendaEditavel;
      motivo?: string | null;
    }) =>
      dataClient.vendas.alterarStatus({
        venda_id: input.venda_id,
        novo_status: input.novo_status,
        motivo: input.motivo ?? null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendas"] });
      qc.invalidateQueries({ queryKey: ["financeiro"] });
      qc.invalidateQueries({ queryKey: ["financeiro-indicadores"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Status da venda atualizado");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useVendaMetricasPeriodo(dataInicio: string, dataFim: string) {
  return useQuery({
    queryKey: ["vendas", "metricas", dataInicio, dataFim],
    queryFn: () =>
      dataClient.vendas.metricasPeriodo({
        data_inicio: dataInicio,
        data_fim: dataFim,
      }),
  });
}

export function useExcluirVendaCancelada() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (venda_id: string) => dataClient.vendas.excluirCancelada(venda_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendas"] });
      qc.invalidateQueries({ queryKey: ["financeiro"] });
      qc.invalidateQueries({ queryKey: ["movimentacoes"] });
      toast.success("Venda excluída com sucesso");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCancelarVenda() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { venda_id: string; motivo?: string | null }) =>
      dataClient.vendas.cancelar(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendas"] });
      qc.invalidateQueries({ queryKey: ["estoque-saldos"] });
      qc.invalidateQueries({ queryKey: ["movimentacoes"] });
      qc.invalidateQueries({ queryKey: ["financeiro"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
