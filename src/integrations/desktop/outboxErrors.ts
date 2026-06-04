/**
 * ============================================================================
 * outboxErrors - classificacao amigavel de erros das outboxes locais
 * ============================================================================
 *
 * Nao muda comportamento de sync: apenas transforma `last_error` cru em uma
 * etiqueta curta e uma mensagem de diagnostico para a UI.
 */
export type OutboxErrorKind =
  | "rede"
  | "auth"
  | "campo-ausente"
  | "valor-invalido"
  | "fk-inexistente"
  | "produto-nao-encontrado"
  | "cliente-invalido"
  | "validacao"
  | "servidor"
  | "dados-antigos"
  | "desconhecido"
  | "nenhum";

export interface OutboxErrorClass {
  kind: OutboxErrorKind;
  label: string;
  friendly: string;
  technical?: string;
}

const NONE: OutboxErrorClass = {
  kind: "nenhum",
  label: "OK",
  friendly: "Sem erros recentes.",
};

export function classifyOutboxError(
  raw: string | null | undefined,
): OutboxErrorClass {
  if (!raw) return NONE;

  const supabaseError = extractSupabaseError(String(raw));
  const combined = [
    raw,
    supabaseError?.code,
    supabaseError?.message,
    supabaseError?.details,
    supabaseError?.hint,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    includesAny(combined, [
      "failed to fetch",
      "networkerror",
      "network error",
      "econnrefused",
      "enotfound",
      "etimedout",
      "timeout",
      "dns",
      "connect error",
      "offline",
    ])
  ) {
    return {
      kind: "rede",
      label: "Sem internet",
      friendly:
        "Sem conexão com a nuvem. Os dados continuam salvos localmente e serão enviados quando a internet voltar.",
    };
  }

  if (
    includesAny(combined, [
      "401",
      "unauthorized",
      "não autenticado",
      "nao autenticado",
      "jwt",
      "invalid token",
      "token expired",
      "not authenticated",
      "permission denied",
    ])
  ) {
    return {
      kind: "auth",
      label: "Sessão expirada",
      friendly:
        "A nuvem rejeitou o envio por falta de autenticação válida. Entre novamente no sistema e reenvie a fila.",
      technical: supabaseError?.message ?? String(raw),
    };
  }

  if (
    combined.includes("produto") &&
    includesAny(combined, [
      "foreign key",
      "23503",
      "not present in table",
      "não encontrado",
      "nao encontrado",
    ])
  ) {
    return {
      kind: "produto-nao-encontrado",
      label: "Produto não encontrado",
      friendly:
        "A nuvem rejeitou a venda porque um produto do payload não existe ou não está sincronizado na nuvem.",
      technical: supabaseError?.message ?? String(raw),
    };
  }

  if (
    combined.includes("cliente") &&
    includesAny(combined, [
      "foreign key",
      "23503",
      "not present in table",
      "inválido",
      "invalido",
      "pendente",
    ])
  ) {
    return {
      kind: "cliente-invalido",
      label: "Cliente inválido",
      friendly:
        "A nuvem rejeitou a venda porque o cliente informado é inválido ou ainda não existe na nuvem.",
      technical: supabaseError?.message ?? String(raw),
    };
  }

  if (
    includesAny(combined, ["foreign key", "23503", "not present in table"])
  ) {
    return {
      kind: "fk-inexistente",
      label: "FK inexistente",
      friendly:
        "A nuvem rejeitou os dados porque uma referência usada no payload não existe na nuvem.",
      technical: supabaseError?.message ?? String(raw),
    };
  }

  if (
    includesAny(combined, [
      "data_vencimento",
      "vencimento",
      "violates not-null",
      "null value in column",
      "not-null constraint",
      "required",
      "obrigat",
      "ausente",
    ])
  ) {
    return {
      kind: "campo-ausente",
      label: "Campo ausente",
      friendly:
        "Campo obrigatório ausente no payload enviado à nuvem. Abra os detalhes para ver o registro e o erro original.",
      technical: supabaseError?.message ?? String(raw),
    };
  }

  if (
    includesAny(combined, [
      "invalid input syntax",
      "invalid input",
      "cannot cast",
      "malformed",
      "valor inválido",
      "valor invalido",
    ])
  ) {
    return {
      kind: "valor-invalido",
      label: "Valor inválido",
      friendly:
        "A nuvem rejeitou o payload porque um campo contém valor inválido para o formato esperado.",
      technical: supabaseError?.message ?? String(raw),
    };
  }

  if (
    includesAny(combined, ["400", "422", "validation", "invalid", "constraint"])
  ) {
    return {
      kind: "validacao",
      label: "Erro retornado pelo Supabase",
      friendly: supabaseError?.message
        ? `Supabase: ${supabaseError.message}`
        : "A nuvem rejeitou os dados. Abra os detalhes para ver o payload e a mensagem original.",
      technical: supabaseError?.details ?? supabaseError?.message ?? String(raw),
    };
  }

  if (
    includesAny(combined, [
      "500",
      "502",
      "503",
      "504",
      "internal server",
      "upstream",
      "supabase",
      "rpc",
    ])
  ) {
    return {
      kind: "servidor",
      label: "Erro na nuvem",
      friendly:
        "A nuvem respondeu com erro. Tentaremos novamente em segundos. Se persistir, acione o suporte.",
      technical: supabaseError?.message ?? String(raw),
    };
  }

  return {
    kind: "desconhecido",
    label: "Erro desconhecido",
    friendly:
      "Falha não classificada ao sincronizar. Confira a mensagem técnica e, se necessário, acione o suporte.",
    technical: supabaseError?.message ?? String(raw),
  };
}

function includesAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}

function extractSupabaseError(raw: string): {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
} | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  try {
    const parsed = JSON.parse(raw.slice(start));
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    return null;
  }
  return null;
}
