import type { MinhaAssinatura } from "@/hooks/useSaasAdmin";

/**
 * Estado efetivo da assinatura, separando claramente TRIAL do plano pago.
 *
 * - "trial": período de teste gratuito (não há plano pago ativo)
 * - "active": plano contratado e em dia
 * - "pending_payment": contratação solicitada, aguardando pagamento
 * - "expired": trial expirou ou pagamento atrasado → modo somente leitura
 * - "canceled": assinatura cancelada
 * - "none": sem empresa / sem assinatura
 */
export type EffectivePlanStatus =
  | "trial"
  | "active"
  | "pending_payment"
  | "expired"
  | "canceled"
  | "none";

export function getEffectivePlanStatus(
  assinatura: MinhaAssinatura | null | undefined,
): EffectivePlanStatus {
  if (!assinatura || assinatura.sem_empresa) return "none";

  switch (assinatura.status) {
    case "trial":
      // Trial expirado conta como expired (readonly)
      if (assinatura.readonly) return "expired";
      return "trial";
    case "ativo":
      return "active";
    case "vencido":
      return "expired";
    case "cancelado":
      return "canceled";
    default:
      return "none";
  }
}

export function isTrialActive(
  assinatura: MinhaAssinatura | null | undefined,
): boolean {
  return getEffectivePlanStatus(assinatura) === "trial";
}

export function isPlanActive(
  assinatura: MinhaAssinatura | null | undefined,
): boolean {
  return getEffectivePlanStatus(assinatura) === "active";
}

export function isAccessBlocked(
  assinatura: MinhaAssinatura | null | undefined,
): boolean {
  const s = getEffectivePlanStatus(assinatura);
  return s === "expired" || s === "canceled";
}
