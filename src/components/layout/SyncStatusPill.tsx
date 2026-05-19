import { useEffect, useState } from "react";
import { CheckCircle2, CloudOff, Loader2, AlertTriangle } from "lucide-react";
import { useAutoSyncState } from "@/hooks/useAutoSync";
import { useDesktopRole } from "@/components/desktop/DesktopRoleProvider";

function formatAgo(ms: number | null): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "agora";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

/**
 * Indicador discreto de sincronização para o topo do AppShell.
 * Só aparece em desktop (terminal/server) — em web é null.
 */
export function SyncStatusPill() {
  const { isDesktop: desk, role } = useDesktopRole();
  const st = useAutoSyncState();
  const [, force] = useState(0);

  // Refresh "há X min" a cada 30s sem depender de state change
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!desk || (role !== "terminal" && role !== "server")) return null;

  let icon = <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
  let text = `Sincronizado há ${formatAgo(st.lastSyncAt)}`;
  let tone = "text-emerald-700";

  if (st.status === "syncing") {
    icon = <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-600" />;
    text = "Sincronizando…";
    tone = "text-sky-700";
  } else if (st.status === "error") {
    icon = <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
    text = "Erro de sincronização";
    tone = "text-destructive";
  } else if (st.status === "idle" && !st.lastSyncAt) {
    icon = <CloudOff className="h-3.5 w-3.5 text-muted-foreground" />;
    text = "Aguardando";
    tone = "text-muted-foreground";
  } else if (st.failedDomains > 0) {
    icon = <CloudOff className="h-3.5 w-3.5 text-amber-600" />;
    text = `${st.failedDomains} pendência(s)`;
    tone = "text-amber-700";
  }

  const tooltip = st.lastSyncAt
    ? `Última sincronização: ${new Date(st.lastSyncAt).toLocaleString("pt-BR")}${
        st.lastError ? `\nErro: ${st.lastError}` : ""
      }`
    : st.lastError ?? "Sem sincronização ainda";

  return (
    <div
      className={`hidden h-11 items-center gap-1.5 border-b border-l border-sidebar-border bg-sidebar px-3 text-[12px] font-medium ${tone} lg:flex`}
      title={tooltip}
      aria-label={text}
    >
      {icon}
      <span className="whitespace-nowrap">{text}</span>
    </div>
  );
}
