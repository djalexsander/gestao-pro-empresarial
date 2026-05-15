import { WifiOff } from "lucide-react";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { isDesktop } from "@/integrations/data/mode";

/**
 * Indicador discreto de offline confirmado (web puro).
 *
 * Só aparece quando `status === "offline"` — ou seja, depois de pelo menos
 * N falhas consecutivas de probe ou `navigator.onLine === false`.
 * Estados `checking` e `unstable` NÃO exibem nada para evitar o falso aviso
 * de "Sem conexão" durante o boot ou em uma falha pontual de rede.
 *
 * No desktop (Tauri), o `DesktopRoleBadge` no topo já mostra o status real
 * (Servidor/Terminal + última fonte de dados), então omitimos esse aviso.
 */
export function OfflineBanner() {
  const { status } = useNetworkStatus();
  if (status !== "offline") return null;
  if (isDesktop()) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[60] flex max-w-xs items-center gap-2 rounded-full border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive shadow-md backdrop-blur"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
      </span>
      <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>Offline. Algumas informações podem estar desatualizadas.</span>
    </div>
  );
}
