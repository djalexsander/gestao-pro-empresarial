import { Server, Monitor, Wifi, WifiOff, Cloud, AlertTriangle, Database } from "lucide-react";
import { useDesktopRole } from "./DesktopRoleProvider";
import { useServerConnection } from "./useServerConnection";
import { useDataSource } from "./useDataSource";

/**
 * Badge compacto exibido no topo do shell quando o app está rodando como
 * desktop. Identifica o papel da máquina, status de conexão com o backend
 * local E qual fonte de dados serviu a última leitura.
 */
export function DesktopRoleBadge() {
  const { isDesktop, role, config } = useDesktopRole();
  const { conn } = useServerConnection();
  const lastSource = useDataSource();

  if (!isDesktop || role === "unset") return null;

  const isServer = role === "server";
  const RoleIcon = isServer ? Server : Monitor;
  const roleLabel = isServer ? "Servidor" : "Terminal";

  const connMap = {
    online: { icon: Wifi, cls: "text-emerald-500" },
    offline: { icon: WifiOff, cls: "text-red-500" },
    "invalid-server": { icon: AlertTriangle, cls: "text-amber-500" },
    "cloud-fallback": { icon: Cloud, cls: "text-blue-500" },
    unknown: { icon: Cloud, cls: "text-muted-foreground" },
  } as const;
  const ConnIcon = connMap[conn.status].icon;

  // Indicador da fonte da última leitura
  const sourceMap = {
    "local-server": { label: "local-server", cls: "text-emerald-500" },
    "local-terminal": { label: "local-terminal", cls: "text-emerald-500" },
    cloud: { label: "cloud", cls: "text-blue-500" },
  } as const;
  const sourceInfo = lastSource ? sourceMap[lastSource.source] : null;

  return (
    <div
      className={`hidden h-11 items-center gap-2 border-b border-l border-sidebar-border px-3 text-[12px] font-medium lg:flex ${
        isServer
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
      }`}
      title={
        role === "terminal" && config.terminal
          ? `${config.terminal.terminalNome} → ${config.terminal.host}:${config.terminal.porta} · ${conn.mensagem ?? conn.status}${
              lastSource
                ? ` · última leitura: ${lastSource.source} (${lastSource.domain}.${lastSource.method}${lastSource.fallback ? ", fallback" : ""})`
                : ""
            }`
          : `${roleLabel} · ${conn.mensagem ?? conn.status}${
              lastSource
                ? ` · última leitura: ${lastSource.source} (${lastSource.domain}.${lastSource.method})`
                : ""
            }`
      }
    >
      <RoleIcon className="h-3.5 w-3.5" />
      <span className="font-semibold">{roleLabel}</span>
      {role === "terminal" && config.terminal?.terminalNome && (
        <span className="opacity-70">· {config.terminal.terminalNome}</span>
      )}
      <span className="mx-1 h-3 w-px bg-current opacity-30" />
      <ConnIcon className={`h-3.5 w-3.5 ${connMap[conn.status].cls}`} />
      {sourceInfo && (
        <>
          <span className="mx-1 h-3 w-px bg-current opacity-30" />
          <Database className={`h-3.5 w-3.5 ${sourceInfo.cls}`} />
          <span className={`text-[11px] ${sourceInfo.cls}`}>
            {sourceInfo.label}
            {lastSource?.fallback ? " (fb)" : ""}
          </span>
        </>
      )}
    </div>
  );
}
