import { AlertTriangle, Loader2, Server } from "lucide-react";
import { useBootController } from "./useLocalServerBoot";
import { useDesktopRole } from "./DesktopRoleProvider";

export function LocalServerStatusIndicator() {
  const { isDesktop, role } = useDesktopRole();
  const boot = useBootController();

  if (!isDesktop || role !== "server") return null;

  const state =
    boot.health === "active"
      ? {
          label: "Servidor local ativo",
          icon: Server,
          className:
            "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        }
      : boot.health === "reconnecting" || boot.health === "unstable"
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
      className={`fixed right-3 top-3 z-[100] flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold shadow-sm backdrop-blur ${state.className}`}
      title={boot.lastError ?? state.label}
    >
      <Icon
        className={`h-3.5 w-3.5 ${
          boot.health === "reconnecting" ? "animate-spin" : ""
        }`}
      />
      {state.label}
    </div>
  );
}
