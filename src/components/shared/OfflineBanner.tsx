import { WifiOff } from "lucide-react";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { getDataMode, isDesktop } from "@/integrations/data/mode";

/**
 * Banner discreto que aparece quando a internet cai.
 *
 * - No desktop (Tauri) modo local-server/local-terminal: avisa que está
 *   operando com dados locais e que a sincronização com a nuvem está pausada.
 * - No web puro: alerta que pode haver dados desatualizados.
 *
 * Não bloqueia nenhuma tela — apenas informa.
 */
export function OfflineBanner() {
  const { online } = useNetworkStatus();
  if (online) return null;

  const mode = getDataMode();
  const desktop = isDesktop();

  const mensagem = desktop
    ? mode === "local-terminal"
      ? "Modo offline: usando servidor local. Sincronização com a nuvem pausada."
      : "Modo offline: usando dados locais. Sincronização com a nuvem pausada."
    : "Sem conexão com a internet. Algumas informações podem estar desatualizadas.";

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-3 left-1/2 z-[60] -translate-x-1/2 flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-4 py-1.5 text-xs font-medium text-amber-700 shadow-md backdrop-blur dark:text-amber-300"
    >
      <WifiOff className="h-3.5 w-3.5" aria-hidden />
      <span>{mensagem}</span>
    </div>
  );
}
