import { Button } from "@/components/ui/button";
import { Wifi, WifiOff, Loader2, RefreshCw } from "lucide-react";
import { useTerminalConexao } from "@/hooks/useTerminalConexao";
import { useDesktopRole } from "@/components/desktop/DesktopRoleProvider";
import { useBootController } from "@/components/desktop/useLocalServerBoot";

/**
 * Banner compacto de status da conexão para o PDV.
 *
 * - Online: pequeno chip verde com latência.
 * - Reconectando: amarelo, mostra tentativa.
 * - Offline: vermelho fixo no topo, bloqueia visualmente e oferece "Reconectar agora".
 */
export function ConexaoStatusBanner({ compact = false }: { compact?: boolean }) {
  const { status, latenciaMs, ultimoSync, tentativas, reconectarAgora } =
    useTerminalConexao();
  const { isDesktop, role } = useDesktopRole();
  const boot = useBootController();
  const visualStatus =
    isDesktop && role === "server"
      ? boot.health === "unavailable"
        ? "offline"
        : boot.health === "reconnecting" || boot.starting
          ? "reconectando"
          : status
      : status;

  if (compact) {
    if (visualStatus === "online") {
      return (
        <div className="flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-600">
          <Wifi className="h-3 w-3" />
          Online
          {latenciaMs !== null && (
            <span className="text-emerald-700/70">· {latenciaMs}ms</span>
          )}
        </div>
      );
    }
    if (visualStatus === "reconectando") {
      return (
        <div className="flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-700">
          <Loader2 className="h-3 w-3 animate-spin" />
          Reconectando…
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] font-medium text-destructive">
        <WifiOff className="h-3 w-3" />
        Offline
      </div>
    );
  }

  if (visualStatus === "online") return null;

  return (
    <div
      className={`flex items-center justify-between gap-3 border-b px-4 py-2 text-sm ${
        visualStatus === "offline"
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-amber-500/40 bg-amber-500/10 text-amber-700"
      }`}
      role="alert"
    >
      <div className="flex items-center gap-2">
        {visualStatus === "offline" ? (
          <WifiOff className="h-4 w-4" />
        ) : (
          <Loader2 className="h-4 w-4 animate-spin" />
        )}
        <div>
          <p className="font-medium">
            {visualStatus === "offline"
              ? "Sem conexão com o servidor"
              : "Reconectando ao servidor…"}
          </p>
          <p className="text-xs opacity-80">
            {visualStatus === "offline"
              ? "Vendas e atualizações estão pausadas até a conexão voltar."
              : `Tentativa ${tentativas}. ${ultimoSync ? `Último sync às ${ultimoSync.toLocaleTimeString()}.` : ""}`}
          </p>
        </div>
      </div>
      <Button
        size="sm"
        variant={visualStatus === "offline" ? "destructive" : "outline"}
        onClick={reconectarAgora}
      >
        <RefreshCw className="mr-1 h-3.5 w-3.5" /> Reconectar agora
      </Button>
    </div>
  );
}
