import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dataClient } from "@/integrations/data";
import type {
  CompraComFornecedorDomain,
  CompraDetalheDomain,
  CompraStatusDomain,
  CriarCompraInput,
  FornecedorMetricaDomain,
  ReceberCompraItensInput,
  ReceberCompraItensResult,
  CompraMetadadosInput as DataCompraMetadadosInput,
  ReceberItemCompraInput,
} from "@/integrations/data/extra-types";

export type CompraStatus = CompraStatusDomain;
export type Compra = CompraComFornecedorDomain;
export type CompraComFornecedor = CompraComFornecedorDomain;
export type CompraDetalhe = CompraDetalheDomain;
export type CompraInput = CriarCompraInput;
export type CompraItemInput = CriarCompraInput["itens"][number];
export type CompraMetadadosInput = DataCompraMetadadosInput;
export type ReceberItemInput = ReceberItemCompraInput;
export type FornecedorMetrica = FornecedorMetricaDomain;

export function useCompras() {
  return useQuery({
    queryKey: ["compras"],
    queryFn: () => dataClient.compras.list({ limit: 500 }),
  });
}

export function useCompra(id: string | undefined) {
  return useQuery({
    queryKey: ["compra", id],
    enabled: !!id,
    queryFn: () => (id ? dataClient.compras.get(id) : null),
  });
}

export function useCreateCompra() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CompraInput) => dataClient.compras.criar(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["compras"] });
      toast.success("Compra registrada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateCompraStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: CompraStatus }) =>
      dataClient.compras.atualizarStatus({ id, status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["compras"] });
      qc.invalidateQueries({ queryKey: ["compra"] });
      qc.invalidateQueries({ queryKey: ["financeiro_lancamentos"] });
      toast.success("Status atualizado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateCompraMetadados() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CompraMetadadosInput) =>
      dataClient.compras.atualizarMetadados(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["compras"] });
      qc.invalidateQueries({ queryKey: ["compra"] });
      qc.invalidateQueries({ queryKey: ["financeiro_lancamentos"] });
      toast.success("Compra atualizada — Contas a Pagar sincronizado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useReceberCompra() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data_recebimento,
      gerar_financeiro,
      data_vencimento,
    }: {
      id: string;
      data_recebimento?: string;
      gerar_financeiro?: boolean;
      data_vencimento?: string | null;
    }) =>
      dataClient.compras.receber({
        id,
        data_recebimento,
        gerar_financeiro,
        data_vencimento,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["compras"] });
      qc.invalidateQueries({ queryKey: ["compra"] });
      qc.invalidateQueries({ queryKey: ["estoque-saldos"] });
      qc.invalidateQueries({ queryKey: ["movimentacoes"] });
      qc.invalidateQueries({ queryKey: ["financeiro-lancamentos"] });
      toast.success("Compra recebida — estoque e financeiro atualizados.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteCompra() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => dataClient.compras.excluir(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["compras"] });
      toast.success("Compra excluída.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useReceberCompraItens() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: ReceberCompraItensInput): Promise<ReceberCompraItensResult> => {
      const itensValidos = params.itens.filter((i) => i.quantidade > 0);
      if (itensValidos.length === 0) {
        throw new Error("Informe ao menos uma quantidade para receber.");
      }
      return dataClient.compras.receberItens({ ...params, itens: itensValidos });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["compras"] });
      qc.invalidateQueries({ queryKey: ["compra"] });
      qc.invalidateQueries({ queryKey: ["estoque-saldos"] });
      qc.invalidateQueries({ queryKey: ["movimentacoes"] });
      qc.invalidateQueries({ queryKey: ["financeiro-lancamentos"] });
      qc.invalidateQueries({ queryKey: ["fornecedor-metricas"] });
      if (res.status === "recebida") {
        toast.success("Compra totalmente recebida — estoque e financeiro atualizados.");
      } else {
        toast.success(`Recebimento parcial registrado (${res.itens_recebidos} item(ns)).`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useFornecedorMetricas() {
  return useQuery({
    queryKey: ["fornecedor-metricas"],
    queryFn: () => dataClient.compras.fornecedorMetricas(),
    staleTime: 30_000,
  });
}

export function gerarNumeroCompra() {
  const d = new Date();
  const yymm = `${d.getFullYear().toString().slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}`;
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `CMP-${yymm}-${rand}`;
}
