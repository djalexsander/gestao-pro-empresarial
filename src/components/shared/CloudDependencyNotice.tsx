/**
 * ============================================================================
 * CloudDependencyNotice — aviso de leitura ainda dependente da nuvem
 * ============================================================================
 *
 * PROMPT 7 (anti split-brain de leituras):
 *
 * Em modo "local-terminal" (terminal conectado ao Servidor Local da LAN),
 * vários relatórios e telas analíticas ainda fazem leitura DIRETO no
 * Supabase. Isso significa que vendas/caixa/financeiro registrados
 * localmente e ainda pendentes de sincronização podem NÃO aparecer aqui.
 *
 * Para evitar que o operador interprete "número zerado" como problema
 * de venda, este componente mostra um aviso claro no topo da tela.
 *
 * - Em modo "cloud" puro o componente NÃO renderiza nada (no-op).
 * - Em modo "local-server" também não renderiza (esse modo lê do
 *   próprio banco local autoritativo).
 * - Em modo "local-terminal" renderiza o aviso amarelo discreto.
 *
 * Nenhuma regra de negócio é alterada — apenas comunicação ao usuário.
 */

import { useSyncExternalStore } from "react";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getDataMode } from "@/integrations/data/mode";

/**
 * Re-avalia o modo a cada render do hook. Como o modo é resolvido a partir
 * de `localStorage` e env, e pode mudar no wizard de desktop, usamos
 * `useSyncExternalStore` ouvindo o evento `storage` para reagir.
 */
function subscribe(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function useDataMode() {
  return useSyncExternalStore(
    subscribe,
    () => getDataMode(),
    () => "cloud" as const,
  );
}

export interface CloudDependencyNoticeProps {
  /**
   * Mensagem customizada. Default: aviso padrão de "ainda depende da nuvem".
   */
  message?: string;
  /**
   * Título do aviso. Default: "Dados deste relatório vêm da nuvem".
   */
  title?: string;
  className?: string;
}

const DEFAULT_TITLE = "Este módulo precisa de internet";
const DEFAULT_MESSAGE =
  "Este módulo precisa de internet. O PDV continua funcionando offline.";

export function CloudDependencyNotice({
  message = DEFAULT_MESSAGE,
  title = DEFAULT_TITLE,
  className,
}: CloudDependencyNoticeProps) {
  const mode = useDataMode();
  if (mode === "cloud") return null;

  return (
    <Alert
      variant="default"
      className={
        "border-warning/40 bg-warning/10 text-warning-foreground" +
        (className ? ` ${className}` : "")
      }
    >
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="text-sm opacity-90">
        {message}
      </AlertDescription>
    </Alert>
  );
}
