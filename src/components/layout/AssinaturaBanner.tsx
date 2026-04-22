import { AlertTriangle, Clock } from "lucide-react";
import { useMinhaAssinatura } from "@/hooks/useSaasAdmin";

/**
 * Banner persistente no topo do ERP.
 * - Vencido/cancelado: aviso crítico (somente leitura).
 * - Trial com <=3 dias: aviso amarelo.
 */
export function AssinaturaBanner() {
  const { data } = useMinhaAssinatura();
  if (!data || data.sem_empresa) return null;

  if (data.readonly) {
    return (
      <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          <strong>Assinatura {data.status}.</strong> O sistema está em modo
          somente-leitura. Regularize para voltar a operar normalmente.
        </span>
      </div>
    );
  }

  if (data.status === "trial" && data.dias_restantes <= 3 && data.dias_restantes >= 0) {
    return (
      <div className="flex items-center gap-2 border-b border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm text-amber-800 dark:text-amber-200">
        <Clock className="h-4 w-4 shrink-0" />
        <span>
          Seu trial termina em <strong>{data.dias_restantes} dia(s)</strong>.
          Contrate um plano para evitar interrupção.
        </span>
      </div>
    );
  }

  return null;
}
