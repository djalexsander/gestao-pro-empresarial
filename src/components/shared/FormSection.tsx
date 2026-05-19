import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "default" | "fiscal" | "operacional" | "financeiro" | "extra";

interface FormSectionProps {
  title: string;
  subtitle?: string;
  /** Ícone opcional ao lado do título. */
  icon?: React.ReactNode;
  /** Marca semântica para destacar visualmente blocos diferentes. */
  tone?: Tone;
  /** Adiciona separador acima da seção. Default: true. */
  divider?: boolean;
  className?: string;
  children: React.ReactNode;
}

const toneStyles: Record<Tone, { label: string; chip: string }> = {
  default: { label: "text-foreground", chip: "" },
  operacional: {
    label: "text-foreground",
    chip: "bg-primary/10 text-primary border-primary/20",
  },
  fiscal: {
    label: "text-foreground",
    chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  },
  financeiro: {
    label: "text-foreground",
    chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  },
  extra: {
    label: "text-foreground",
    chip: "bg-muted text-muted-foreground border-border",
  },
};

const toneLabel: Record<Tone, string | null> = {
  default: null,
  operacional: "Operacional",
  fiscal: "Fiscal",
  financeiro: "Financeiro",
  extra: "Complementar",
};

/**
 * Bloco visual reutilizável para separar grupos lógicos em formulários:
 * operacional, fiscal, financeiro, complementar.
 *
 * Apenas UX/layout — não altera regras, validações ou estado.
 */
export function FormSection({
  title,
  subtitle,
  icon,
  tone = "default",
  divider = true,
  className,
  children,
}: FormSectionProps) {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug(
      tone === "fiscal"
        ? "[FORM_LAYOUT] grupo fiscal"
        : tone === "operacional"
          ? "[FORM_LAYOUT] grupo operacional"
          : "[FORM_LAYOUT] seção renderizada",
      { title, tone },
    );
  }

  const styles = toneStyles[tone];
  const chipLabel = toneLabel[tone];

  return (
    <section
      className={cn(
        "space-y-3",
        divider && "border-t border-border/60 pt-4 first:border-t-0 first:pt-0",
        className,
      )}
      aria-label={title}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h3 className={cn("flex items-center gap-2 text-sm font-semibold", styles.label)}>
            {icon ? <span className="text-muted-foreground">{icon}</span> : null}
            {title}
          </h3>
          {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {chipLabel ? (
          <span
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              styles.chip,
            )}
          >
            {chipLabel}
          </span>
        ) : null}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** Divisor visual horizontal para usar entre subgrupos. */
export function FormDivider({ className }: { className?: string }) {
  return <hr className={cn("my-2 border-border/60", className)} />;
}
