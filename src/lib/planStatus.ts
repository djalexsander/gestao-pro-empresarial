import type { MinhaAssinatura } from "@/hooks/useSaasAdmin";

/**
 * Estado efetivo da assinatura — padrão SaaS canônico.
 *
 * - "trial": período de teste gratuito
 * - "active": plano contratado e em dia
 * - "pending_payment": cobrança gerada, aguardando pagamento
 * - "overdue": vencido há ≤ período de tolerância → acesso limitado
 * - "expired": vencido há mais que tolerância → bloqueio total
 * - "canceled": assinatura cancelada
 * - "none": sem empresa / sem assinatura
 */
export type EffectivePlanStatus =
  | "trial"
  | "active"
  | "pending_payment"
  | "overdue"
  | "expired"
  | "canceled"
  | "none";

/**
 * O backend já retorna o status canônico em inglês (após a migração SaaS).
 * Mantemos compatibilidade com rótulos antigos em PT.
 */
export function getEffectivePlanStatus(
  assinatura: MinhaAssinatura | null | undefined,
): EffectivePlanStatus {
  if (!assinatura || assinatura.sem_empresa) return "none";

  const raw = String(assinatura.status ?? "").toLowerCase();

  if (raw === "trial") return assinatura.readonly ? "expired" : "trial";
  if (raw === "active" || raw === "ativo") return "active";
  if (raw === "pending_payment") return "pending_payment";
  if (raw === "overdue") return "overdue";
  if (raw === "expired" || raw === "vencido") return "expired";
  if (raw === "canceled" || raw === "cancelado") return "canceled";

  // Sinaliza pendência se o backend marcou tem_pendente
  if (assinatura.tem_pendente) return "pending_payment";

  return "none";
}

export function isTrialActive(a: MinhaAssinatura | null | undefined): boolean {
  return getEffectivePlanStatus(a) === "trial";
}

export function isPlanActive(a: MinhaAssinatura | null | undefined): boolean {
  return getEffectivePlanStatus(a) === "active";
}

/** Bloqueio total (somente leitura). */
export function isAccessBlocked(a: MinhaAssinatura | null | undefined): boolean {
  const s = getEffectivePlanStatus(a);
  return s === "expired" || s === "canceled";
}

/** Acesso limitado (overdue) — pode ler, mas escrever depende da feature. */
export function isAccessLimited(a: MinhaAssinatura | null | undefined): boolean {
  return getEffectivePlanStatus(a) === "overdue";
}
