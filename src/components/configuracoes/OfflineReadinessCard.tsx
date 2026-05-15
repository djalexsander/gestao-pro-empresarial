/**
 * Card de "Prontidão Offline" — Etapa 3.
 *
 * Mostra de forma discreta na aba Configurações > Desktop:
 *  - status geral (pronto / pendente / erro);
 *  - última sincronização;
 *  - botão "Sincronizar dados para uso offline";
 *  - lista simples dos módulos sincronizados.
 *
 * Não altera layout principal do app.
 */
import {
  CheckCircle2,
  CloudDownload,
  AlertTriangle,
  Loader2,
  XCircle,
  Database,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useOfflineReadiness } from "@/hooks/useOfflineReadiness";
import type { TerminalConexaoConfig } from "@/integrations/desktop/types";

interface Props {
  cfg?: TerminalConexaoConfig;
}

function formatTs(ms: number | null | undefined): string {
  if (!ms) return "nunca";
  try {
    return new Date(ms).toLocaleString("pt-BR");
  } catch {
    return "—";
  }
}

export function OfflineReadinessCard({ cfg }: Props) {
  const { status, loading, syncing, error, sincronizar, lastSync } =
    useOfflineReadiness(cfg);

  const ready = status?.ready === true;
  const completed = status?.initial_sync_completed === true;

  const statusBadge = !status ? (
    <Badge variant="outline">consultando…</Badge>
  ) : ready ? (
    <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
      <CheckCircle2 className="mr-1 h-3 w-3" /> Pronto
    </Badge>
  ) : completed ? (
    <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30">
      <AlertTriangle className="mr-1 h-3 w-3" /> Parcial
    </Badge>
  ) : (
    <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30">
      <XCircle className="mr-1 h-3 w-3" /> Pendente
    </Badge>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">Prontidão offline</CardTitle>
        </div>
        {statusBadge}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground">
          {completed
            ? "Este computador já foi preparado para uso offline. Você pode rodar a sincronização novamente quando precisar atualizar os dados locais."
            : "Este computador ainda não foi preparado para uso offline. Conecte à internet uma vez e sincronize os dados."}
        </div>

        <div className="grid gap-2 text-xs sm:grid-cols-2">
          <div className="rounded-md border bg-muted/30 p-2">
            <div className="text-muted-foreground">Última sincronização</div>
            <div className="font-medium">
              {formatTs(status?.initial_sync_at_ms ?? null)}
            </div>
          </div>
          <div className="rounded-md border bg-muted/30 p-2">
            <div className="text-muted-foreground">Schema local</div>
            <div className="font-medium">v{status?.schema_version ?? "—"}</div>
          </div>
        </div>

        {status?.warnings?.length ? (
          <ul className="space-y-1 rounded-md border border-amber-300/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400">
            {status.warnings.map((w, i) => (
              <li key={i} className="flex gap-2">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {error ? (
          <div className="rounded-md border border-rose-300/40 bg-rose-500/5 p-2 text-xs text-rose-700 dark:text-rose-400">
            {error}
          </div>
        ) : null}

        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">
            Módulos
          </div>
          <ul className="divide-y rounded-md border">
            {(status?.domains ?? []).map((d) => (
              <li
                key={d.domain}
                className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs"
              >
                <div className="flex items-center gap-2">
                  {d.ready ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-rose-500" />
                  )}
                  <span className="font-medium">{d.label}</span>
                </div>
                <div className="flex items-center gap-3 text-muted-foreground">
                  <span>{d.row_count} regs</span>
                  <span className="hidden sm:inline">
                    {formatTs(d.last_synced_ms)}
                  </span>
                </div>
              </li>
            ))}
            {!status?.domains?.length && (
              <li className="px-2 py-1.5 text-xs text-muted-foreground">
                {loading ? "Carregando…" : "Nenhum módulo reportado."}
              </li>
            )}
          </ul>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="text-xs text-muted-foreground">
            {lastSync
              ? `Última execução: +${lastSync.total_delta} regs em ${lastSync.results.length} módulo(s).`
              : status?.upstream_configured
                ? "Sincronização baixa dados da nuvem para o banco local."
                : "Servidor local sem upstream configurado."}
          </div>
          <Button
            size="sm"
            onClick={() => void sincronizar()}
            disabled={syncing || !cfg || !status?.upstream_configured}
          >
            {syncing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sincronizando…
              </>
            ) : (
              <>
                <CloudDownload className="mr-2 h-4 w-4" />
                Sincronizar dados para uso offline
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
