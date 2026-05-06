import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AutorizacaoAcao =
  | "fechar_caixa_divergencia"
  | "fechar_caixa_qualquer"
  | "remover_item_venda"
  | "cancelar_venda"
  | "cancelar_compra"
  | "excluir_lancamento_financeiro"
  | "alterar_valor_confirmado"
  | "reabrir_caixa";

export type AutorizacaoMetodo = "pin_funcionario" | "senha_master" | "codigo_qr";

export interface AutorizacoesConfig {
  owner_id: string;
  exigir_fechar_caixa_divergencia: boolean;
  exigir_fechar_caixa_qualquer: boolean;
  exigir_remover_item_venda: boolean;
  exigir_cancelar_venda: boolean;
  exigir_cancelar_compra: boolean;
  exigir_excluir_lancamento_financeiro: boolean;
  exigir_alterar_valor_confirmado: boolean;
  exigir_reabrir_caixa: boolean;
  metodo_pin_habilitado: boolean;
  metodo_senha_master_habilitado: boolean;
  metodo_codigo_qr_habilitado: boolean;
  senha_master_hash: string | null;
  codigo_qr_hash: string | null;
  codigo_qr_label: string | null;
  papeis_autorizadores: string[];
}

export interface AutorizacaoLog {
  id: string;
  acao: AutorizacaoAcao;
  metodo: AutorizacaoMetodo;
  status: "autorizado" | "negado";
  contexto: string;
  autorizador_nome: string | null;
  valor_envolvido: number | null;
  diferenca_caixa: number | null;
  motivo_negacao: string | null;
  created_at: string;
}

export function useAutorizacoesConfig() {
  return useQuery({
    queryKey: ["autorizacoes_config"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("autorizacoes_config_obter");
      if (error) throw error;
      return data as AutorizacoesConfig;
    },
  });
}

export function useSalvarAutorizacoesConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data, error } = await (supabase as any).rpc("autorizacoes_config_salvar", { _payload: payload });
      if (error) throw error;
      return data as AutorizacoesConfig;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["autorizacoes_config"] }),
  });
}

export function useAutorizacoesLog(limit = 100) {
  return useQuery({
    queryKey: ["autorizacoes_log", limit],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("autorizacoes_log")
        .select("id, acao, metodo, status, contexto, autorizador_nome, valor_envolvido, diferenca_caixa, motivo_negacao, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as AutorizacaoLog[];
    },
  });
}

export interface ValidarAutorizacaoInput {
  acao: AutorizacaoAcao;
  metodo: AutorizacaoMetodo;
  payload: Record<string, string>;
  contexto: string;
  contexto_dados?: Record<string, unknown>;
  valor_envolvido?: number | null;
  diferenca_caixa?: number | null;
  referencia_tipo?: string | null;
  referencia_id?: string | null;
  solicitante_funcionario_id?: string | null;
  terminal_id?: string | null;
}

export async function validarAutorizacao(input: ValidarAutorizacaoInput) {
  const { data, error } = await (supabase as any).rpc("autorizacao_validar", {
    _acao: input.acao,
    _metodo: input.metodo,
    _payload: input.payload,
    _contexto: input.contexto,
    _contexto_dados: input.contexto_dados ?? {},
    _valor_envolvido: input.valor_envolvido ?? null,
    _diferenca_caixa: input.diferenca_caixa ?? null,
    _referencia_tipo: input.referencia_tipo ?? null,
    _referencia_id: input.referencia_id ?? null,
    _solicitante_funcionario_id: input.solicitante_funcionario_id ?? null,
    _terminal_id: input.terminal_id ?? null,
    _user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
  });
  if (error) throw error;
  return data as { autorizado: boolean; motivo: string | null; autorizador_nome: string | null };
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
