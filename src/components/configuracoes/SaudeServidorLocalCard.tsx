/**
 * SaudeServidorLocalCard — Etapa 12
 *
 * Card de Saúde do Servidor Local (Desktop). Reúne:
 *  - status do daemon HTTP (running / port / hostname)
 *  - integridade SQLite (PRAGMA integrity_check / quick_check / WAL / size)
 *  - watchdog (tentativas de restart automáticas com backoff)
 *  - botão "Exportar diagnóstico" gerando JSON sanitizado (sem secrets)
 *
 * Aditivo: não remove nada de OfflineHealthCard / SuporteDiagnosticoCard,
 * apenas amplia o que o suporte consegue ver sem entrar na máquina.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
  ServerCog,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  getLocalSqliteHealth,
  type LocalServerStatus,
  type SqliteHealthPayload,
} from "@/integrations/desktop/tauriBridge";
import { useLocalServerWatchdog } from "@/hooks/useLocalServerWatchdog";
import type { StartLocalServerOptions } from "@/integrations/desktop/tauriBridge";
import { APP_VERSION } from "@/lib/version";

interface Props {
  /** Opções usadas para reiniciar o servidor (mesmas do botão "Iniciar"). */
  startOptions: StartLocalServerOptions | null;
  /** Status conhecido do daemon (origem externa). Watchdog também polia. */
  daemon?: LocalServerStatus | null;
}

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

/** Remove campos sensíveis antes de exportar o diagnóstico. */
function sanitize<T>(input: T): T {
  const BLOCK = new Set([
    "senha",
    "password",
    "pin",
    "token",
    "access_token",
    "refresh_token",
    "service_role",
    "service_role_key",
    "anon_key",
    "secret",
    "private_key",
    "jwt",
    "authorization",
  ]);
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (BLOCK.has(k.toLowerCase())) {
          out[k] = "***redacted***";
        } else {
          out[k] = walk(val);
        }
      }
      return out;
    }
    return v;
  };
  return walk(input) as T;
}

export function SaudeServidorLocalCard({ startOptions, daemon }: Props) {
  const [sqlite, setSqlite] = useState<SqliteHealthPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const watchdog = useLocalServerWatchdog(startOptions, !!startOptions);

  const status = watchdog.status ?? daemon ?? null;

  const loadHealth = useCallback(async () => {
    setLoading(true);
    try {
      const h = await getLocalSqliteHealth();
      setSqlite(h);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHealth();
    const id = window.setInterval(loadHealth, 60_000);
    return () => window.clearInterval(id);
  }, [loadHealth]);

  const integridade: "ok" | "warn" | "fail" = useMemo(() => {
    if (!sqlite) return "warn";
    if (sqlite.integrity_ok && sqlite.quick_ok) return "ok";
    return "fail";
  }, [sqlite]);

  const daemonBadge = !status ? (
    <Badge variant="outline">consultando…</Badge>
  ) : status.running ? (
    <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
      <CheckCircle2 className="mr-1 h-3 w-3" /> Rodando :{status.port}
    </Badge>
  ) : (
    <Badge className="border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-400">
      <XCircle className="mr-1 h-3 w-3" /> Parado
    </Badge>
  );

  const integridadeBadge =
    integridade === "ok" ? (
      <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="mr-1 h-3 w-3" /> Integridade OK
      </Badge>
    ) : integridade === "fail" ? (
      <Badge className="border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-400">
        <ShieldAlert className="mr-1 h-3 w-3" /> Integridade ruim
      </Badge>
    ) : (
      <Badge variant="outline">
        <AlertTriangle className="mr-1 h-3 w-3" /> Sem dado
      </Badge>
    );

  async function exportarDiagnostico() {
    setExporting(true);
    try {
      const snapshot = sanitize({
        generated_at: new Date().toISOString(),
        app_version: APP_VERSION,
        machine: {
          hostname: status?.hostname ?? null,
          server_id: status?.server_id ?? null,
          server_name: status?.server_name ?? null,
        },
        daemon: status,
        sqlite,
        watchdog: {
          restarting: watchdog.restarting,
          restart_attempts: watchdog.restartAttempts,
          failed: watchdog.failed,
          last_restart_at: watchdog.lastRestartAt,
          last_error: watchdog.lastError,
        },
      });
      const json = JSON.stringify(snapshot, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      a.download = `gestao-pro-saude-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      console.log("[LOCAL_DIAGNOSTIC] exportado");
      toast.success("Diagnóstico exportado.");
    } catch (e) {
      console.error("[LOCAL_DIAGNOSTIC] erro:", e);
      toast.error("Não foi possível exportar o diagnóstico.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ServerCog className="h-4 w-4" /> Saúde do servidor local
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            {daemonBadge}
            {integridadeBadge}
            {watchdog.restarting && (
              <Badge variant="outline">
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                Reiniciando ({watchdog.restartAttempts})
              </Badge>
            )}
            {watchdog.failed && (
              <Badge className="border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-400">
                <AlertTriangle className="mr-1 h-3 w-3" />
                Restart falhou
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
          <Metric label="Versão app" value={APP_VERSION} />
          <Metric label="Schema" value={sqlite?.schema_version ?? "—"} />
          <Metric label="Journal" value={sqlite?.journal_mode ?? "—"} />
          <Metric
            label="Integrity check"
            value={sqlite?.integrity_detail ?? "—"}
            warn={!!sqlite && !sqlite.integrity_ok}
          />
          <Metric
            label="Quick check"
            value={sqlite?.quick_detail ?? "—"}
            warn={!!sqlite && !sqlite.quick_ok}
          />
          <Metric
            label="Tamanho banco"
            value={fmtBytes(sqlite?.db_size_bytes ?? 0)}
          />
          <Metric
            label="WAL"
            value={fmtBytes(sqlite?.wal_size_bytes ?? 0)}
          />
          <Metric label="Hostname" value={status?.hostname ?? "—"} />
          <Metric label="Porta" value={status?.port ?? "—"} />
        </div>

        {watchdog.lastError && (
          <p className="text-xs text-rose-600 dark:text-rose-400">
            Último erro: {watchdog.lastError}
          </p>
        )}

        {integridade === "fail" && (
          <p className="text-xs text-rose-700 dark:text-rose-400">
            Problemas de integridade detectados. Crie um backup antes de qualquer
            outra ação e considere restaurar um backup recente em Backup &amp;
            Segurança. O sistema <strong>nunca</strong> apaga o banco
            automaticamente.
          </p>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void loadHealth()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3 w-3" />
            )}
            Verificar agora
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void watchdog.restartNow()}
            disabled={watchdog.restarting || !startOptions}
          >
            {watchdog.restarting ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Activity className="mr-1 h-3 w-3" />
            )}
            Reiniciar servidor
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void exportarDiagnostico()}
            disabled={exporting}
          >
            {exporting ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Download className="mr-1 h-3 w-3" />
            )}
            Exportar diagnóstico
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  warn,
}: {
  label: string;
  value: number | string | null | undefined;
  warn?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={
          "truncate text-sm font-semibold " +
          (warn ? "text-rose-600 dark:text-rose-400" : "")
        }
        title={String(value ?? "")}
      >
        {value ?? "—"}
      </div>
    </div>
  );
}
