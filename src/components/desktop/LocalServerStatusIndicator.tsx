import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { useBootController } from "./useLocalServerBoot";
import { useDesktopRole } from "./DesktopRoleProvider";

export function LocalServerStatusIndicator() {
  const { isDesktop, role } = useDesktopRole();
  const boot = useBootController();

  if (!isDesktop || role !== "server") return null;
  if (boot.health === "active") return null;

  const state =
    boot.health === "reconnecting" || boot.health === "unstable"
      ? {
          label: "Reconectando servidor local...",
          icon: Loader2,
          className:
            "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        }
      : {
          label: "Servidor local indisponível",
          icon: AlertTriangle,
          className:
            "border-destructive/40 bg-destructive/10 text-destructive",
        };
  const Icon = state.icon;

  return (
    <div
      className={`fixed bottom-3 right-3 z-[100] flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold shadow-lg backdrop-blur ${state.className}`}
      title={boot.lastError ?? state.label}
    >
      <Icon
        className={`h-3.5 w-3.5 ${
          boot.health === "reconnecting" ? "animate-spin" : ""
        }`}
      />
      <span>{state.label}</span>
      {boot.health === "unavailable" && (
        <button
          type="button"
          onClick={() => void boot.restart()}
          disabled={boot.starting}
          className="ml-1 inline-flex items-center gap-1 rounded border border-current/30 px-2 py-1 transition-colors hover:bg-current/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-3 w-3 ${boot.starting ? "animate-spin" : ""}`} />
          Reiniciar
        </button>
      )}
    </div>
  );
}
