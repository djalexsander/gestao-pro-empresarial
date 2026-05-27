/**
 * ============================================================================
 * outboxErrors — classificação amigável de erros das outboxes locais
 * ============================================================================
 *
 * As outboxes (estoque, vendas, caixa, cancelamentos, financeiro) gravam o
 * `last_error` retornado pelo upstream (Supabase/RPC) ou pelo próprio
 * scheduler local. As mensagens originais são técnicas (HTTP 401, fetch
 * failed, "invalid input syntax for type date", etc.). Este módulo
 * traduz para categorias e mensagens curtas para o operador/admin.
 *
 * Não muda comportamento de sync — só leitura/diagnóstico.
 */
export type OutboxErrorKind =
  | "rede"
  | "auth"
  | "validacao"
  | "servidor"
  | "dados-antigos"
  | "desconhecido"
  | "nenhum";

export interface OutboxErrorClass {
  kind: OutboxErrorKind;
  label: string;
  friendly: string;
}

const NONE: OutboxErrorClass = {
  kind: "nenhum",
  label: "OK",
  friendly: "Sem erros recentes.",
};

/**
 * Classifica um `last_error` cru numa categoria amigável.
 * Não joga fora a mensagem original — quem renderiza ainda pode mostrá-la
 * em detalhe; este helper apenas dá uma etiqueta e uma frase curta.
 */
export function classifyOutboxError(
  raw: string | null | undefined,
): OutboxErrorClass {
  if (!raw) return NONE;
  const msg = String(raw).toLowerCase();

  // --- rede / conectividade ---
  if (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network error") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("etimedout") ||
    msg.includes("timeout") ||
    msg.includes("dns") ||
    msg.includes("connect error") ||
    msg.includes("offline")
  ) {
    return {
      kind: "rede",
      label: "Sem internet",
      friendly:
        "Sem conexão com a nuvem. Os dados continuam salvos localmente e serão enviados quando a internet voltar.",
    };
  }

  // --- autenticação / JWT ---
  if (
    msg.includes("401") ||
    msg.includes("unauthorized") ||
    msg.includes("jwt") ||
    msg.includes("invalid token") ||
    msg.includes("token expired") ||
    msg.includes("not authenticated") ||
    msg.includes("permission denied")
  ) {
    return {
      kind: "auth",
      label: "Sessão expirada",
      friendly:
        "Sessão da nuvem expirou ou perdeu autorização. Saia e entre novamente para retomar o envio.",
    };
  }

  // --- dados antigos / inconsistência conhecida (ex.: fiado sem vencimento) ---
  if (
    msg.includes("data_vencimento") ||
    msg.includes("vencimento") ||
    msg.includes("invalid input syntax for type date") ||
    msg.includes("violates not-null") ||
    msg.includes("null value in column")
  ) {
    return {
      kind: "dados-antigos",
      label: "Dado obrigatório faltando",
      friendly:
        "Um registro antigo está sem um campo obrigatório (ex.: fiado sem data de vencimento). Edite o registro original ou peça suporte para corrigir.",
    };
  }

  // --- validação (HTTP 4xx genérico, schema, regra de negócio) ---
  if (
    msg.includes("400") ||
    msg.includes("422") ||
    msg.includes("validation") ||
    msg.includes("invalid") ||
    msg.includes("constraint") ||
    msg.includes("foreign key")
  ) {
    return {
      kind: "validacao",
      label: "Dados inválidos",
      friendly:
        "A nuvem rejeitou os dados por validação. Verifique o registro original ou acione o suporte.",
    };
  }

  // --- servidor / cloud (5xx, "internal", etc.) ---
  if (
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("internal server") ||
    msg.includes("upstream") ||
    msg.includes("supabase") ||
    msg.includes("rpc")
  ) {
    return {
      kind: "servidor",
      label: "Erro na nuvem",
      friendly:
        "A nuvem respondeu com erro. Tentaremos novamente em segundos. Se persistir, acione o suporte.",
    };
  }

  return {
    kind: "desconhecido",
    label: "Erro desconhecido",
    friendly:
      "Falha não classificada ao sincronizar. Confira a mensagem técnica e, se necessário, acione o suporte.",
  };
}
