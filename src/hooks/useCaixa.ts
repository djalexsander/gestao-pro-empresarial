import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { dataClient } from "@/integrations/data";

export type CaixaStatus = "aberto" | "fechado";

export interface Caixa {
  id: string;
  owner_id: string;
  usuario_id: string;
  operador_id: string | null;
  data_abertura: string;
  data_fechamento: string | null;
  valor_inicial: number;
  total_vendas: number;
  qtd_vendas: number;
  total_dinheiro: number;
  total_pix: number;
  total_debito: number;
  total_credito: number;
  total_boleto: number;
  total_ifood: number;
  total_fiado: number;
  total_outros: number;
  total_sangrias: number;
  total_suprimentos: number;
  valor_esperado: number | null;
  valor_informado: number | null;
  diferenca: number | null;
  status: CaixaStatus;
  observacao: string | null;
  observacao_fechamento: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaixaResumo {
  caixa_id: string;
  status: CaixaStatus;
  data_abertura: string;
  data_fechamento: string | null;
  valor_inicial: number;
  qtd_vendas: number;
  total_vendas: number;
  total_dinheiro: number;
  total_pix: number;
  total_debito: number;
  total_credito: number;
  total_boleto: number;
  total_ifood: number;
  total_fiado: number;
  total_outros: number;
  total_sangrias: number;
  total_suprimentos: number;
  valor_esperado: number;
  valor_informado: number | null;
  diferenca: number | null;
}

export type MovimentoTipo =
  | "abertura"
  | "venda"
  | "sangria"
  | "suprimento"
  | "fechamento";

export interface CaixaMovimento {
  id: string;
  caixa_id: string;
  tipo: MovimentoTipo;
  valor: number;
  motivo: string | null;
  venda_id: string | null;
  usuario_id: string | null;
  operador_id: string | null;
  created_at: string;
}

/**
 * Caixa aberto do operador atual (ou do admin se sem operador).
 * Quando _operador_id é null, busca o caixa aberto sem operador (admin direto).
 */
export function useCaixaAberto(operadorId?: string | null) {
  return useQuery({
    queryKey: ["caixa", "aberto", operadorId ?? "admin"],
    queryFn: () =>
      dataClient.caixa.aberto({ operador_id: operadorId ?? null }) as Promise<Caixa | null>,
    staleTime: 10_000,
  });
}

/**
 * Qualquer caixa aberto do dono — usado no painel admin /caixa, que precisa
 * enxergar caixas abertos por operadores no PDV (e não só os do próprio admin).
 * Retorna o mais recente em aberto.
 */
export function useQualquerCaixaAberto() {
  return useQuery({
    queryKey: ["caixa", "aberto", "qualquer"],
    queryFn: () => dataClient.caixa.aberto({ qualquer: true }) as Promise<Caixa | null>,
    staleTime: 10_000,
  });
}

/** Resumo ao vivo do caixa (totais por forma de pagamento). */
export function useCaixaResumo(caixaId: string | null | undefined) {
  const qc = useQueryClient();

  // Realtime: invalida o resumo quando vendas/movimentos do caixa mudam.
  // Mantemos a assinatura específica por caixa_id (filtro server-side via
  // `filter:`), porque o invalidationBus global cobre apenas o domínio
  // inteiro — aqui queremos refrescar apenas o caixa visível.
  useEffect(() => {
    if (!caixaId) return;
    const channel = supabase
      .channel(`caixa-resumo-${caixaId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "caixa_movimentos", filter: `caixa_id=eq.${caixaId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["caixa", "resumo", caixaId] });
          qc.invalidateQueries({ queryKey: ["caixa", "movimentos", caixaId] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "vendas", filter: `caixa_id=eq.${caixaId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["caixa", "resumo", caixaId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [caixaId, qc]);

  return useQuery({
    queryKey: ["caixa", "resumo", caixaId],
    enabled: !!caixaId,
    queryFn: async (): Promise<CaixaResumo | null> => {
      if (!caixaId) return null;
      return (await dataClient.caixa.resumo(caixaId)) as CaixaResumo | null;
    },
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
}

/** Lista de caixas (histórico). */
export function useCaixasHistorico(limit = 50) {
  return useQuery({
    queryKey: ["caixa", "historico", limit],
    queryFn: () => dataClient.caixa.historico({ limit }) as Promise<Caixa[]>,
    staleTime: 30_000,
  });
}

/** Movimentos de um caixa específico. */
export function useCaixaMovimentos(caixaId: string | null | undefined) {
  return useQuery({
    queryKey: ["caixa", "movimentos", caixaId],
    enabled: !!caixaId,
    queryFn: async (): Promise<CaixaMovimento[]> => {
      if (!caixaId) return [];
      return (await dataClient.caixa.movimentos(caixaId)) as CaixaMovimento[];
    },
    staleTime: 10_000,
  });
}

export function useAbrirCaixa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      valor_inicial: number;
      observacao?: string | null;
      operador_id?: string | null;
      terminal_id?: string | null;
    }) => dataClient.caixa.abrir(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["caixa"] });
      qc.invalidateQueries({ queryKey: ["terminais"] });
      toast.success("Caixa aberto com sucesso.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useRegistrarMovimentoCaixa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      caixa_id: string;
      tipo: "sangria" | "suprimento";
      valor: number;
      motivo?: string | null;
      /**
       * Chave de idempotência. Recomenda-se gerar 1 UUID por modal aberto
       * (sangria/suprimento) e mantê-lo estável até confirmar/cancelar.
       * Reenvio com mesmo UUID retorna o id existente sem duplicar.
       */
      client_uuid?: string | null;
    }) => dataClient.caixa.registrarMovimento(input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["caixa"] });
      toast.success(
        vars.tipo === "sangria"
          ? "Sangria registrada."
          : "Suprimento registrado.",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useFecharCaixa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      caixa_id: string;
      valor_informado: number;
      observacao?: string | null;
    }) => dataClient.caixa.fechar(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["caixa"] });
      qc.invalidateQueries({ queryKey: ["vendas"] });
      qc.invalidateQueries({ queryKey: ["financeiro_lancamentos"] });
      toast.success("Caixa fechado. Movimentos enviados ao Financeiro.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useExcluirCaixa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caixa_id: string) => dataClient.caixa.excluir(caixa_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["caixa"] });
      qc.invalidateQueries({ queryKey: ["vendas"] });
      toast.success("Caixa excluído.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
