import { Server, Monitor, Wifi, WifiOff, Cloud, AlertTriangle } from "lucide-react";
import { useDesktopRole } from "./DesktopRoleProvider";
import { useServerConnection } from "./useServerConnection";

/**
 * Badge compacto exibido no topo do shell quando o app está rodando como
 * desktop. Identifica o papel da máquina E o status real de conexão com o
 * backend local.
 */
export function DesktopRoleBadge() {
  const { isDesktop, role, config } = useDesktopRole();
  const { conn } = useServerConnection();

  if (!isDesktop || role === "unset") return null;

  const isServer = role === "server";
  const RoleIcon = isServer ? Server : Monitor;
  const roleLabel = isServer ? "Servidor" : "Terminal";

  // Mini-ícone de conexão à direita
  const connMap = {
    online: { icon: Wifi, cls: "text-emerald-500" },
    offline: { icon: WifiOff, cls: "text-red-500" },
    "invalid-server": { icon: AlertTriangle, cls: "text-amber-500" },
    "cloud-fallback": { icon: Cloud, cls: "text-blue-500" },
    unknown: { icon: Cloud, cls: "text-muted-foreground" },
  } as const;
  const ConnIcon = connMap[conn.status].icon;

  return (
    <div
      className={`hidden h-11 items-center gap-2 border-b border-l border-sidebar-border px-3 text-[12px] font-medium lg:flex ${
        isServer
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
      }`}
      title={
        role === "terminal" && config.terminal
          ? `${config.terminal.terminalNome} → ${config.terminal.host}:${config.terminal.porta} · ${conn.mensagem ?? conn.status}`
          : `${roleLabel} · ${conn.mensagem ?? conn.status}`
      }
    >
      <RoleIcon className="h-3.5 w-3.5" />
      <span className="font-semibold">{roleLabel}</span>
      {role === "terminal" && config.terminal?.terminalNome && (
        <span className="opacity-70">· {config.terminal.terminalNome}</span>
      )}
      <span className="mx-1 h-3 w-px bg-current opacity-30" />
      <ConnIcon className={`h-3.5 w-3.5 ${connMap[conn.status].cls}`} />
    </div>
  );
}
