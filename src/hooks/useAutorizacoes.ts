import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dataClient } from "@/integrations/data";
import type {
  AutorizacaoAcaoDomain,
  AutorizacaoCartaoDomain,
  AutorizacaoLogDomain,
  AutorizacaoLogFiltro,
  AutorizacaoMetodoDomain,
  AutorizacoesConfigDomain,
  CriarCartaoAutorizacaoInput,
  ValidarAutorizacaoInputDomain,
  ValidarAutorizacaoResultDomain,
} from "@/integrations/data/extra-adapters";

export type AutorizacaoAcao = AutorizacaoAcaoDomain;
export type AutorizacaoMetodo = AutorizacaoMetodoDomain;
export type AutorizacoesConfig = AutorizacoesConfigDomain;
export type AutorizacaoLog = AutorizacaoLogDomain;
export type AutorizacaoCartao = AutorizacaoCartaoDomain;
export type ValidarAutorizacaoInput = ValidarAutorizacaoInputDomain;
export type AutorizacaoLogFiltroInput = AutorizacaoLogFiltro;

export function useAutorizacoesConfig() {
  return useQuery({
    queryKey: ["autorizacoes_config"],
    queryFn: () => dataClient.autorizacoes.obterConfig(),
  });
}

export function useSalvarAutorizacoesConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      dataClient.autorizacoes.salvarConfig(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["autorizacoes_config"] }),
  });
}

export function useAutorizacoesLog(filtro?: AutorizacaoLogFiltro | number) {
  const key = typeof filtro === "number" || filtro == null ? { limit: filtro ?? 100 } : filtro;
  return useQuery({
    queryKey: ["autorizacoes_log", key],
    queryFn: () => dataClient.autorizacoes.log(filtro),
  });
}

export function useAutorizacaoCartoes() {
  return useQuery({
    queryKey: ["autorizacao_cartoes"],
    queryFn: () => dataClient.autorizacoes.listarCartoes(),
  });
}

export function useCriarCartaoAutorizacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CriarCartaoAutorizacaoInput) =>
      dataClient.autorizacoes.criarCartao(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["autorizacao_cartoes"] }),
  });
}

export function useSetCartaoAtivo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; ativo: boolean }) =>
      dataClient.autorizacoes.setCartaoAtivo(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["autorizacao_cartoes"] }),
  });
}

export function useExcluirCartaoAutorizacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => dataClient.autorizacoes.excluirCartao(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["autorizacao_cartoes"] }),
  });
}

export async function validarAutorizacao(
  input: ValidarAutorizacaoInput,
): Promise<ValidarAutorizacaoResultDomain> {
  return dataClient.autorizacoes.validar({
    ...input,
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
  });
}

export const ACAO_LABELS: Record<AutorizacaoAcao, string> = {
  fechar_caixa_divergencia: "Fechar caixa com divergência",
  fechar_caixa_qualquer: "Fechar qualquer caixa",
  remover_item_venda: "Remover item da venda",
  cancelar_venda: "Cancelar venda",
  cancelar_compra: "Cancelar compra",
  excluir_lancamento_financeiro: "Excluir lançamento financeiro",
  alterar_valor_confirmado: "Alterar valor já confirmado",
  reabrir_caixa: "Reabrir caixa fechado",
  sangria_caixa: "Sangria de caixa",
  suprimento_caixa: "Suprimento de caixa",
};
