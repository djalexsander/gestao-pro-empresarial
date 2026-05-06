import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dataClient } from "@/integrations/data/client";
import type { CobrancaCriadaDomain } from "@/integrations/data/extra-adapters";

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

export type CobrancaCriada = CobrancaCriadaDomain;

/* =========================================================
 * QUERIES
 * =======================================================*/
export function usePlanosDisponiveis() {
  return useQuery({
    queryKey: ["planos-disponiveis"],
    staleTime: 60_000,
    queryFn: async () => (await dataClient.saasCliente.planosDisponiveis()) as PlanoDisponivel[],
  });
}

export function useModulosDisponiveisCliente() {
  return useQuery({
    queryKey: ["modulos-disponiveis-cliente"],
    staleTime: 60_000,
    queryFn: async () =>
      (await dataClient.saasCliente.modulosDisponiveisCliente()) as ModuloDisponivelCliente[],
  });
}

/* =========================================================
 * MUTATIONS
 * =======================================================*/
export function useSolicitarPlano() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (plano_id: string) => dataClient.saasCliente.solicitarPlano(plano_id),
    onSuccess: ({ cobranca }) => {
      qc.invalidateQueries({ queryKey: ["planos-disponiveis"] });
      if (!cobranca) {
        toast.success(
          "Solicitação enviada! Aguarde a confirmação do pagamento pelo suporte.",
        );
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSolicitarModulo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modulo_id: string) => dataClient.saasCliente.solicitarModulo(modulo_id),
    onSuccess: ({ cobranca }) => {
      qc.invalidateQueries({ queryKey: ["modulos-disponiveis-cliente"] });
      qc.invalidateQueries({ queryKey: ["meus-modulos"] });
      if (!cobranca) {
        toast.success(
          "Solicitação enviada! Aguarde a liberação após confirmação do pagamento.",
        );
      }
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
    mutationFn: () => dataClient.saasCliente.resetarDadosEmpresa(),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Todos os dados operacionais foram apagados.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
