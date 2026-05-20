import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CloudOff,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  fetchSyncOverview,
  sincronizarTudoAgora,
  type SyncOverview,
} from "@/integrations/desktop/serverConnection";
import type { TerminalConexaoConfig } from "@/integrations/desktop/types";
import { purgeLocalState } from "@/integrations/data/local-purge";

interface Props {
  cfg: TerminalConexaoConfig;
}

function fmtDate(ms: number | null | undefined) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("pt-BR");
}

const DOMAIN_LABEL: Record<string, string> = {
  estoque: "Estoque",
  vendas: "Vendas",
  cancelamentos: "Cancelamentos",
  caixa: "Caixa",
  financeiro: "Financeiro",
  clientes: "Clientes",
  fornecedores: "Fornecedores",
  compras: "Compras",
};

/**
 * Card "Sincronização" da Etapa 11. Mostra contagem agregada de pendentes /
 * processando / sincronizados / erros / conflitos para todas as outboxes,
 * com botão "Sincronizar agora" que dispara o flush em paralelo. Toda
 * lógica crítica fica no servidor local; aqui só consumimos endpoints.
 */
export function SincronizacaoCard({ cfg }: Props) {
  const [ov, setOv] = useState<SyncOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [purging, setPurging] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const queryClient = useQueryClient();

  const recarregar = async () => {
    const r = await fetchSyncOverview(cfg);
    setOv(r);
  };

  useEffect(() => {
    void recarregar();
    const t = setInterval(() => void recarregar(), 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.host, cfg.porta]);

  const handleSync = async () => {
    setBusy(true);
    try {
      const r = await sincronizarTudoAgora(cfg);
      if (r.failed === 0) {
        toast.success("Sincronização concluída", {
          description: `${r.ok} domínio(s) processado(s).`,
        });
      } else {
        toast.warning("Sincronização parcial", {
          description: `${r.ok} ok, ${r.failed} falharam — veja detalhes.`,
        });
      }
      await recarregar();
    } finally {
      setBusy(false);
    }
  };

  const handlePurge = async () => {
    if (!window.confirm(
      "Limpar cache local desta máquina?\n\n" +
      "Isso remove dados em cache do React Query, filas offline e bancos locais. " +
      "Você continua logado. Use isso se o Dashboard estiver mostrando dados antigos " +
      "ou se a sincronização estiver presa em erro de autenticação."
    )) return;
    setPurging(true);
    try {
      const r = await purgeLocalState("user.manual_purge", queryClient);
      toast.success("Cache local limpo", {
        description: `${r.localStorageKeys} chave(s) localStorage, ${r.indexedDbs} IndexedDB removidos.`,
      });
      await recarregar();
    } finally {
      setPurging(false);
    }
  };

  const totalProblemas = (ov?.error ?? 0) + (ov?.conflict ?? 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <RefreshCw className="h-4 w-4" />
          Sincronização
          {totalProblemas > 0 && (
            <Badge variant="destructive" className="ml-1">
              {totalProblemas} {totalProblemas === 1 ? "problema" : "problemas"}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Resumo */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Stat label="Pendentes" value={ov?.pending ?? 0} tone="warn" />
          <Stat label="Processando" value={ov?.processing ?? 0} tone="info" />
          <Stat label="Sincronizados" value={ov?.synced ?? 0} tone="ok" />
          <Stat label="Erros" value={ov?.error ?? 0} tone="error" />
          <Stat label="Conflitos" value={ov?.conflict ?? 0} tone="error" />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            Última sincronização:{" "}
            <span className="font-medium text-foreground">
              {fmtDate(ov?.last_sent_at_ms)}
            </span>
          </span>
          {ov?.error === 0 && ov?.pending === 0 && ov?.conflict === 0 ? (
            <span className="inline-flex items-center gap-1 text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" /> Tudo em dia
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-amber-600">
              <CloudOff className="h-3.5 w-3.5" /> Há dados aguardando envio
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSync} disabled={busy}>
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Sincronizar agora
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowDetails((v) => !v)}
          >
            {showDetails ? (
              <ChevronUp className="mr-2 h-4 w-4" />
            ) : (
              <ChevronDown className="mr-2 h-4 w-4" />
            )}
            {showDetails ? "Ocultar detalhes" : "Ver detalhes"}
          </Button>
        </div>

        {/* Detalhes por domínio */}
        {showDetails && (
          <div className="rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Domínio</th>
                  <th className="px-2 py-2 text-right font-medium">Pend.</th>
                  <th className="px-2 py-2 text-right font-medium">Proc.</th>
                  <th className="px-2 py-2 text-right font-medium">Sync</th>
                  <th className="px-2 py-2 text-right font-medium">Err.</th>
                  <th className="px-2 py-2 text-right font-medium">Conf.</th>
                  <th className="px-3 py-2 text-left font-medium">Último erro</th>
                </tr>
              </thead>
              <tbody>
                {(ov?.domains ?? []).map((d) => (
                  <tr key={d.domain} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">
                      {DOMAIN_LABEL[d.domain] ?? d.domain}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{d.pending}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{d.processing}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-emerald-600">
                      {d.synced}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {d.error > 0 ? (
                        <span className="inline-flex items-center justify-end gap-1 text-destructive">
                          <AlertTriangle className="h-3 w-3" /> {d.error}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {d.conflict > 0 ? (
                        <span className="inline-flex items-center justify-end gap-1 text-destructive">
                          <ShieldAlert className="h-3 w-3" /> {d.conflict}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground max-w-[18rem] truncate" title={d.last_error ?? ""}>
                      {d.last_error ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          Cada domínio usa fila offline idempotente (client_uuid único) com
          retry e backoff. Reexecutar o flush não duplica registros já
          sincronizados. Conflitos não são sobrescritos — ficam visíveis aqui
          para resolução manual.
        </p>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "error" | "info";
}) {
  const toneCls = {
    ok: "text-emerald-600",
    warn: "text-amber-600",
    error: "text-destructive",
    info: "text-sky-600",
  }[tone];
  return (
    <div className="rounded-md border border-border bg-muted/30 px-2 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`text-lg font-semibold tabular-nums ${value > 0 ? toneCls : "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}
