/**
 * OfflineHealthCard — Configurações > Desktop > Saúde Offline
 *
 * Etapa 5 (continuação). Mostra diagnóstico do estoque local: saldos
 * negativos, movimentações órfãs, status da outbox. Permite acionar
 * `rebuild_local_stock` quando algo divergir.
 */
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Wrench,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useOfflineStockHealth } from "@/hooks/useOfflineStockHealth";
import type { TerminalConexaoConfig } from "@/integrations/desktop/types";

interface Props {
  cfg?: TerminalConexaoConfig;
}

function fmtTs(ms: number | null | undefined): string {
  if (!ms) return "nunca";
  try {
    return new Date(ms).toLocaleString("pt-BR");
  } catch {
    return "—";
  }
}

export function OfflineHealthCard({ cfg }: Props) {
  const { health, loading, rebuilding, error, lastRebuild, refresh, rebuild } =
    useOfflineStockHealth(cfg);

  const status = health?.status ?? null;
  const badge = !health ? (
    <Badge variant="outline">consultando…</Badge>
  ) : status === "ok" ? (
    <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
      <CheckCircle2 className="mr-1 h-3 w-3" /> Saudável
    </Badge>
  ) : status === "warning" ? (
    <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30">
      <AlertTriangle className="mr-1 h-3 w-3" /> Atenção
    </Badge>
  ) : (
    <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30">
      <XCircle className="mr-1 h-3 w-3" /> Problema
    </Badge>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" /> Saúde Offline (Estoque)
          </CardTitle>
          {badge}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error && (
          <p className="text-rose-600 dark:text-rose-400">{error}</p>
        )}

        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
          <Metric label="Produtos c/ saldo" value={health?.total_saldos} />
          <Metric label="Movimentações" value={health?.total_movimentacoes} />
          <Metric label="Auditoria" value={health?.auditoria_total} />
          <Metric
            label="Saldos negativos"
            value={health?.saldos_negativos}
            warn={(health?.saldos_negativos ?? 0) > 0}
          />
          <Metric
            label="Movs órfãs"
            value={health?.movimentacoes_orfas}
            warn={(health?.movimentacoes_orfas ?? 0) > 0}
          />
          <Metric
            label="Duplicadas"
            value={health?.movimentacoes_duplicadas}
            warn={(health?.movimentacoes_duplicadas ?? 0) > 0}
          />
          <Metric
            label="Outbox pendente"
            value={health?.outbox_pendentes}
          />
          <Metric
            label="Outbox erros"
            value={health?.outbox_erros}
            warn={(health?.outbox_erros ?? 0) > 0}
          />
          <Metric label="Última auditoria" value={fmtTs(health?.last_audit_ms)} />
        </div>

        {lastRebuild && (
          <p className="text-xs text-muted-foreground">
            Último recálculo: {lastRebuild.saldos_corrigidos} saldos •{" "}
            {fmtTs(lastRebuild.now_ms)}
          </p>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void refresh()}
            disabled={loading || rebuilding}
          >
            {loading ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3 w-3" />
            )}
            Verificar
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void rebuild()}
            disabled={rebuilding || !cfg?.host}
          >
            {rebuilding ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Wrench className="mr-1 h-3 w-3" />
            )}
            Recalcular saldos
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
          "text-sm font-semibold " +
          (warn ? "text-rose-600 dark:text-rose-400" : "")
        }
      >
        {value ?? "—"}
      </div>
    </div>
  );
}
