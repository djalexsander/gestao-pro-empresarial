import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type CaixaStatus = "aberto" | "fechado";

export interface Caixa {
  id: string;
  owner_id: string;
  usuario_id: string;
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
  created_at: string;
}

/** Caixa aberto do usuário atual (ou null se nenhum). Atualizado a cada 15s. */
export function useCaixaAberto() {
  return useQuery({
    queryKey: ["caixa", "aberto"],
    queryFn: async (): Promise<Caixa | null> => {
      const { data: uid } = await supabase.auth.getUser();
      if (!uid.user) return null;
      const { data, error } = await supabase
        .from("caixas")
        .select("*")
        .eq("owner_id", uid.user.id)
        .eq("usuario_id", uid.user.id)
        .eq("status", "aberto")
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
  return useQuery({
    queryKey: ["caixa", "resumo", caixaId],
    enabled: !!caixaId,
    queryFn: async (): Promise<CaixaResumo | null> => {
      if (!caixaId) return null;
      const { data, error } = await supabase.rpc("caixa_resumo", {
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
    mutationFn: async (input: { valor_inicial: number; observacao?: string | null }) => {
      const { data, error } = await supabase.rpc("abrir_caixa", {
        _valor_inicial: input.valor_inicial,
        _observacao: input.observacao ?? null,
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
      const { data, error } = await supabase.rpc("caixa_registrar_movimento", {
        _caixa_id: input.caixa_id,
        _tipo: input.tipo,
        _valor: input.valor,
        _motivo: input.motivo ?? null,
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
      const { data, error } = await supabase.rpc("fechar_caixa", {
        _caixa_id: input.caixa_id,
        _valor_informado: input.valor_informado,
        _observacao: input.observacao ?? null,
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
