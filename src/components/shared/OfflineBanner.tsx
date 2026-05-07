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
      className="fixed bottom-4 right-4 z-[60] flex max-w-sm items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-800 shadow-lg backdrop-blur dark:bg-amber-500/20 dark:text-amber-200"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
      </span>
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
      <span>{mensagem}</span>
    </div>
  );
}
