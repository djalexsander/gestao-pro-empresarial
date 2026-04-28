import { AlertTriangle, Clock } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useMinhaAssinatura } from "@/hooks/useSaasAdmin";
import { getEffectivePlanStatus } from "@/lib/planStatus";

/**
 * Banner persistente no topo do ERP.
 * - expired/canceled: aviso crítico (somente leitura).
 * - overdue: aviso laranja (acesso limitado).
 * - pending_payment: lembra de finalizar pagamento.
 * - trial com ≤3 dias: aviso amarelo.
 */
export function AssinaturaBanner() {
  const { data } = useMinhaAssinatura();
  if (!data || data.sem_empresa) return null;

  const status = getEffectivePlanStatus(data);

  if (status === "expired" || status === "canceled") {
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="flex-1">
          <strong>Acesso bloqueado.</strong> Sua assinatura está{" "}
          {status === "expired" ? "vencida" : "cancelada"}. Regularize para voltar a operar.
        </span>
        <Link to="/planos" className="rounded-md bg-destructive px-3 py-1 text-xs font-medium text-destructive-foreground">
          Pagar para continuar
        </Link>
      </div>
    );
  }

  if (status === "overdue") {
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-orange-500/30 bg-orange-500/10 px-4 py-2 text-sm text-orange-900 dark:text-orange-200">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="flex-1">
          <strong>Sua assinatura venceu há {data.dias_atraso ?? 0} dia(s).</strong> Acesso limitado — pague para liberar tudo.
        </span>
        <Link to="/planos" className="rounded-md bg-orange-600 px-3 py-1 text-xs font-medium text-white">
          Regularizar
        </Link>
      </div>
    );
  }

  if (status === "pending_payment") {
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm text-amber-900 dark:text-amber-200">
        <Clock className="h-4 w-4 shrink-0" />
        <span className="flex-1">
          Você tem uma cobrança Pix pendente. Finalize o pagamento para ativar seu plano/módulos.
        </span>
        <Link to="/planos" className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white">
          Ver cobrança
        </Link>
      </div>
    );
  }

  if (status === "trial" && data.dias_restantes <= 3 && data.dias_restantes >= 0) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm text-amber-800 dark:text-amber-200">
        <Clock className="h-4 w-4 shrink-0" />
        <span className="flex-1">
          Seu teste termina em <strong>{data.dias_restantes} dia(s)</strong>.
        </span>
        <Link to="/planos" className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
          Contratar agora
        </Link>
      </div>
    );
  }

  return null;
}
