import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const toneClass: Record<Tone, string> = {
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/15 text-warning-foreground border-warning/30",
  danger: "bg-destructive/10 text-destructive border-destructive/20",
  info: "bg-info/10 text-info border-info/20",
  neutral: "bg-muted text-muted-foreground border-border",
};

const statusMap: Record<string, Tone> = {
  Pago: "success",
  Recebido: "success",
  Ativo: "success",
  OK: "success",
  Pendente: "warning",
  Baixo: "warning",
  Vencido: "danger",
  Cancelado: "danger",
  Crítico: "danger",
  Esgotado: "danger",
  Inativo: "neutral",
};

interface StatusBadgeProps {
  status: string;
  tone?: Tone;
  className?: string;
}

export function StatusBadge({ status, tone, className }: StatusBadgeProps) {
  const resolved = tone ?? statusMap[status] ?? "neutral";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        toneClass[resolved],
        className
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          resolved === "success" && "bg-success",
          resolved === "warning" && "bg-warning",
          resolved === "danger" && "bg-destructive",
          resolved === "info" && "bg-info",
          resolved === "neutral" && "bg-muted-foreground"
        )}
      />
      {labelMap[status] ?? status}
    </span>
  );
}
