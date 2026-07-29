export type CommercialStatus =
  | "active" | "trial" | "pending_payment" | "overdue"
  | "expired" | "canceled" | "blocked" | "none";

export type CommercialState = {
  status: CommercialStatus;
  planName: string | null;
  expiresAt?: string | null;
  activeModules?: number;
};

export function statusLabelPt(status: string): string {
  const labels: Record<string, string> = {
    active: "ativo", ativo: "ativo",
    pending: "pendente", pending_payment: "pendente",
    canceled: "cancelado", cancelled: "cancelado", cancelado: "cancelado",
    expired: "expirado", vencido: "expirado",
    trial: "período de teste",
    blocked: "bloqueado", bloqueado: "bloqueado",
    overdue: "atrasado",
  };
  return labels[status.toLowerCase()] ?? status;
}

export function resolveCommercialPlan(state: CommercialState | null, today: string) {
  if (!state) return { planName: "Free", status: "sem assinatura", activeModules: 0 };
  const expiredByDate = Boolean(state.expiresAt && state.expiresAt < today);
  const valid = (state.status === "active" || state.status === "trial") && !expiredByDate;
  return {
    planName: valid ? (state.planName ?? (state.status === "trial" ? "Período de teste" : "Free")) : "Free",
    status: statusLabelPt(expiredByDate ? "expired" : state.status),
    activeModules: valid ? (state.activeModules ?? 0) : 0,
  };
}

