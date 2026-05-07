import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dataClient } from "@/integrations/data";
import type {
  AutorizacaoAcaoDomain,
  AutorizacaoCartaoDomain,
  AutorizacaoLogDomain,
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

export function useAutorizacoesLog(limit = 100) {
  return useQuery({
    queryKey: ["autorizacoes_log", limit],
    queryFn: () => dataClient.autorizacoes.log(limit),
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
};
