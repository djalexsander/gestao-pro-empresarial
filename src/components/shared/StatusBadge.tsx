import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const toneClass: Record<Tone, string> = {
  success: "bg-success/10 text-success border-success/25",
  warning: "bg-warning/15 text-warning-foreground border-warning/35",
  danger: "bg-destructive/10 text-destructive border-destructive/25",
  info: "bg-info/10 text-info border-info/25",
  neutral: "bg-muted/70 text-muted-foreground border-border",
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
  // enum values do banco (lowercase)
  ativo: "success",
  inativo: "neutral",
  rascunho: "neutral",
  pendente: "warning",
  parcial: "info",
  Parcial: "info",
  pago: "success",
  aprovada: "info",
  recebida_parcial: "info",
  recebida: "success",
  cancelada: "danger",
  vencido: "danger",
};

const labelMap: Record<string, string> = {
  ativo: "Ativo",
  inativo: "Inativo",
  rascunho: "Rascunho",
  pendente: "Pendente",
  parcial: "Parcial",
  pago: "Pago",
  aprovada: "Aprovada",
  recebida_parcial: "Recebida parcial",
  recebida: "Recebida",
  cancelada: "Cancelada",
  vencido: "Vencido",
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
        "whitespace-nowrap",
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
