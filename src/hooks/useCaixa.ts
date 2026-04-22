import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

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
    queryFn: async (): Promise<Caixa | null> => {
      const { data: uid } = await supabase.auth.getUser();
      if (!uid.user) return null;
      let query = supabase
        .from("caixas")
        .select("*")
        .eq("owner_id", uid.user.id)
        .eq("status", "aberto");
      if (operadorId) {
        query = query.eq("operador_id", operadorId);
      } else {
        query = query.is("operador_id", null);
      }
      const { data, error } = await query
        .order("data_abertura", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as Caixa | null) ?? null;
    },
    staleTime: 10_000,
  });
}

/** Resumo ao vivo do caixa (totais por forma de pagamento). */
export function useCaixaResumo(caixaId: string | null | undefined) {
  const qc = useQueryClient();

  // Realtime: invalida o resumo quando vendas/movimentos do caixa mudam.
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("caixa_resumo", {
        _caixa_id: caixaId,
      });
      if (error) throw error;
      return data as unknown as CaixaResumo;
    },
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
}

/** Lista de caixas (histórico). */
export function useCaixasHistorico(limit = 50) {
  return useQuery({
    queryKey: ["caixa", "historico", limit],
    queryFn: async (): Promise<Caixa[]> => {
      const { data, error } = await supabase
        .from("caixas")
        .select("*")
        .order("data_abertura", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as Caixa[];
    },
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
      const { data, error } = await supabase
        .from("caixa_movimentos")
        .select("*")
        .eq("caixa_id", caixaId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CaixaMovimento[];
    },
    staleTime: 10_000,
  });
}

export function useAbrirCaixa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      valor_inicial: number;
      observacao?: string | null;
      operador_id?: string | null;
    }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("abrir_caixa", {
        _valor_inicial: input.valor_inicial,
        _observacao: input.observacao ?? undefined,
        _operador_id: input.operador_id ?? undefined,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["caixa"] });
      toast.success("Caixa aberto com sucesso.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useRegistrarMovimentoCaixa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      caixa_id: string;
      tipo: "sangria" | "suprimento";
      valor: number;
      motivo?: string | null;
    }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("caixa_registrar_movimento", {
        _caixa_id: input.caixa_id,
        _tipo: input.tipo,
        _valor: input.valor,
        _motivo: input.motivo ?? undefined,
      });
      if (error) throw error;
      return data as string;
    },
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
    mutationFn: async (input: {
      caixa_id: string;
      valor_informado: number;
      observacao?: string | null;
    }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("fechar_caixa", {
        _caixa_id: input.caixa_id,
        _valor_informado: input.valor_informado,
        _observacao: input.observacao ?? undefined,
      });
      if (error) throw error;
      return data as { diferenca: number; valor_esperado: number };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["caixa"] });
      qc.invalidateQueries({ queryKey: ["vendas"] });
      toast.success("Caixa fechado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
