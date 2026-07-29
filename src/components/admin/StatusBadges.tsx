import { cn } from "@/lib/utils";
import type { EmpresaStatus, EmpresaPlano } from "@/hooks/useAdmin";

const statusTone: Record<EmpresaStatus, string> = {
  ativa: "bg-success/10 text-success border-success/20",
  inativa: "bg-muted text-muted-foreground border-border",
  bloqueada: "bg-destructive/10 text-destructive border-destructive/20",
};

const statusLabel: Record<EmpresaStatus, string> = {
  ativa: "Ativa",
  inativa: "Inativa",
  bloqueada: "Bloqueada",
};

const statusDot: Record<EmpresaStatus, string> = {
  ativa: "bg-success",
  inativa: "bg-muted-foreground",
  bloqueada: "bg-destructive",
};

export function EmpresaStatusBadge({ status, className }: { status: EmpresaStatus; className?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
      statusTone[status], className,
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full", statusDot[status])} />
      {statusLabel[status]}
    </span>
  );
}

export function PlanoBadge({ plano, className }: { plano: EmpresaPlano; className?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
      plano.toLowerCase() === "free"
        ? "bg-muted text-muted-foreground border-border"
        : "bg-primary/10 text-primary border-primary/20",
      className,
    )}>
      {plano}
    </span>
  );
}
