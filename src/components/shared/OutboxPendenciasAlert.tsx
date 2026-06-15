/**
 * OutboxPendenciasAlert — banner reutilizável que mostra o estado das filas
 * offline (pendentes/erros) quando o terminal está em modo local/desktop.
 *
 * Usado dentro do fechamento de caixa para alertar o operador de que ainda
 * existem operações locais não confirmadas na nuvem. NÃO bloqueia o
 * fechamento (regra de negócio não muda) — apenas dá visibilidade.
 *
 * Em modo cloud puro ou web (`enabled=false`), não renderiza nada.
 */
import { AlertTriangle, Cloud, CloudOff } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useOutboxPendingSummary } from "@/hooks/useOutboxPendingSummary";
import { cn } from "@/lib/utils";

interface Props {
  /** Texto opcional acima do detalhamento. */
  contexto?: string;
  className?: string;
  caixaId?: string | null;
  currentDayOnly?: boolean;
}

export function OutboxPendenciasAlert({
  contexto,
  className,
  caixaId,
  currentDayOnly,
}: Props) {
  const summary = useOutboxPendingSummary({ caixaId, currentDayOnly });

  if (!summary.enabled) return null;
  if (summary.totalPending === 0 && summary.totalError === 0) return null;

  const temErro = summary.totalError > 0;
  const Icon = temErro ? CloudOff : Cloud;

  return (
    <div
      className={cn(
        "rounded-md border p-3 text-sm",
        temErro
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        className,
      )}
    >
      <div className="mb-1 flex items-center gap-2 font-semibold">
        <Icon className="h-4 w-4" />
        {temErro
          ? "Existem operações com erro de sincronização"
          : "Existem operações pendentes para a nuvem"}
      </div>
      {contexto && <p className="mb-2 text-xs opacity-90">{contexto}</p>}
      <ul className="space-y-0.5 text-xs">
        {summary.comErro.map((d) => (
          <li key={d.key} className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              <strong>{d.label}</strong>: {d.error} com erro
              {d.pending > 0 ? ` · ${d.pending} pendente(s)` : ""} —{" "}
              <em>{d.lastErrorClass.friendly}</em>
            </span>
          </li>
        ))}
        {summary.comPendencia.map((d) => (
          <li key={d.key} className="flex items-start gap-2">
            <Cloud className="mt-0.5 h-3 w-3 shrink-0 opacity-70" />
            <span>
              <strong>{d.label}</strong>: {d.pending} pendente(s) aguardando envio
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] opacity-90">
        Nada está perdido — os dados estão salvos localmente e o app continua
        tentando enviar.{" "}
        <Link
          to="/configuracoes"
          className="underline underline-offset-2 hover:opacity-80"
        >
          Ver detalhes em Configurações → Desktop
        </Link>
        .
      </p>
    </div>
  );
}
