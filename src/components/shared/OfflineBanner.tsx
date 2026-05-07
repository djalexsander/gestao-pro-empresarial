import { WifiOff } from "lucide-react";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { isDesktop } from "@/integrations/data/mode";

/**
 * Banner discreto que aparece quando a internet cai (web puro).
 *
 * No desktop (Tauri) NÃO renderizamos esse toast: o `DesktopRoleBadge`
 * no topo da shell já mostra o status real (Servidor/Terminal +
 * conexão + última fonte de dados), então um toast flutuante seria
 * redundante e poluiria a tela.
 *
 * No web puro mantemos o aviso porque é a única indicação visual de
 * que dados podem estar desatualizados.
 */
export function OfflineBanner() {
  const { online } = useNetworkStatus();
  if (online) return null;
  if (isDesktop()) return null;

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
      <span>Sem conexão com a internet. Algumas informações podem estar desatualizadas.</span>
    </div>
  );
}

