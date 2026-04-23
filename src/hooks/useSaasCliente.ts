import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/* =========================================================
 * Tipos visíveis ao cliente (dono da empresa)
 * =======================================================*/
export type PlanoDisponivel = {
  id: string;
  nome: string;
  descricao: string | null;
  valor: number;
  tipo_cobranca: "mensal" | "anual" | "vitalicio";
  limite_usuarios: number | null;
  limite_produtos: number | null;
  ordem: number;
  atual: boolean;
};

export type ModuloDisponivelCliente = {
  id: string;
  nome: string;
  chave: string;
  descricao: string | null;
  valor: number;
  aplica_restricao: boolean;
  /** "ativo" | "pendente" | "cancelado" | "nao_contratado" */
  status: string;
  data_expiracao: string | null;
};

/* =========================================================
 * QUERIES
 * =======================================================*/
export function usePlanosDisponiveis() {
  return useQuery({
    queryKey: ["planos-disponiveis"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("planos_disponiveis");
      if (error) throw error;
      return (data ?? []) as PlanoDisponivel[];
    },
  });
}

export function useModulosDisponiveisCliente() {
  return useQuery({
    queryKey: ["modulos-disponiveis-cliente"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)(
        "modulos_disponiveis_cliente",
      );
      if (error) throw error;
      return (data ?? []) as ModuloDisponivelCliente[];
    },
  });
}

/* =========================================================
 * MUTATIONS
 * =======================================================*/
export function useSolicitarPlano() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (plano_id: string) => {
      const { error } = await (supabase.rpc as any)(
        "solicitar_contratacao_plano",
        { _plano_id: plano_id },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["planos-disponiveis"] });
      toast.success(
        "Solicitação enviada! Aguarde a confirmação do pagamento pelo suporte.",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSolicitarModulo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (modulo_id: string) => {
      const { error } = await (supabase.rpc as any)(
        "solicitar_contratacao_modulo",
        { _modulo_id: modulo_id },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["modulos-disponiveis-cliente"] });
      qc.invalidateQueries({ queryKey: ["meus-modulos"] });
      toast.success(
        "Solicitação enviada! Aguarde a liberação após confirmação do pagamento.",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* =========================================================
 * RESET DE DADOS
 * =======================================================*/
export function useResetarDadosEmpresa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await (supabase.rpc as any)("resetar_dados_empresa");
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Todos os dados operacionais foram apagados.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
