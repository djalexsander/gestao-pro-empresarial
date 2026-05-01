import { Server, Monitor } from "lucide-react";
import { useDesktopRole } from "./DesktopRoleProvider";

/**
 * Badge compacto exibido no topo do shell quando o app está rodando como
 * desktop. Identifica visualmente o papel da máquina (Servidor ou Terminal).
 *
 * Em web ou desktop ainda não configurado, não renderiza nada.
 */
export function DesktopRoleBadge() {
  const { isDesktop, role, config } = useDesktopRole();
  if (!isDesktop || role === "unset") return null;

  const isServer = role === "server";
  const Icon = isServer ? Server : Monitor;
  const label = isServer ? "Servidor Local" : "Terminal Cliente";

  return (
    <div
      className={`hidden h-11 items-center gap-2 border-b border-l border-sidebar-border px-3 text-[12px] font-medium lg:flex ${
        isServer
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
      }`}
      title={
        role === "terminal" && config.terminal
          ? `${config.terminal.terminalNome} → ${config.terminal.host}:${config.terminal.porta}`
          : label
      }
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="font-semibold">{label}</span>
      {role === "terminal" && config.terminal?.terminalNome && (
        <span className="opacity-70">· {config.terminal.terminalNome}</span>
      )}
    </div>
  );
}
