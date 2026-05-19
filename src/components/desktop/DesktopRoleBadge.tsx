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

  // Indicador da fonte de dados — preferimos a VERDADE do probe
  // (`conn.status`) em vez de só a última telemetria de leitura. Assim, se
  // o servidor local está online mas uma chamada específica caiu para
  // cloud (ex.: método ainda não wrappeado), o badge continua mostrando
  // "servidor local" como fonte primária e marca a query atual com um
  // chip secundário de "fallback cloud" — sem mais o enganoso "cloud (fb)".
  const serverOnline = conn.status === "online";
  const usouFallbackAgora = !!lastSource?.fallback;

  let sourceLabel: string;
  let sourceCls: string;
  if (serverOnline) {
    sourceLabel = role === "server" ? "servidor local" : "servidor local (LAN)";
    sourceCls = "text-emerald-500";
  } else if (lastSource?.source === "local-server" || lastSource?.source === "local-terminal") {
    sourceLabel = lastSource.source;
    sourceCls = "text-emerald-500";
  } else if (lastSource?.source === "cloud") {
    sourceLabel = "cloud";
    sourceCls = "text-blue-500";
  } else {
    sourceLabel = "—";
    sourceCls = "text-muted-foreground";
  }

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
                ? ` · última leitura: ${lastSource.source} (${lastSource.domain}.${lastSource.method}${lastSource.fallback ? ", fallback cloud" : ""})`
                : ""
            }`
          : `${roleLabel} · ${conn.mensagem ?? conn.status}${
              lastSource
                ? ` · última leitura: ${lastSource.source} (${lastSource.domain}.${lastSource.method}${lastSource.fallback ? ", fallback cloud" : ""})`
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
      <span className="mx-1 h-3 w-px bg-current opacity-30" />
      <Database className={`h-3.5 w-3.5 ${sourceCls}`} />
      <span className={`text-[11px] ${sourceCls}`}>{sourceLabel}</span>
      {serverOnline && usouFallbackAgora && (
        <span
          className="ml-1 rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
          title={`Esta consulta usou cloud como fallback (${lastSource?.domain}.${lastSource?.method}).`}
        >
          + fallback cloud
        </span>
      )}
    </div>
  );
}

