import { useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Stethoscope, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  fetchBackupStatus,
  fetchCaixaLocalAberto,
  fetchDomainStats,
  fetchOfflineStatus,
  fetchSyncOverview,
} from "@/integrations/desktop/serverConnection";
import {
  getLocalServerStatus,
  getLocalSqliteHealth,
} from "@/integrations/desktop/tauriBridge";
import type { TerminalConexaoConfig } from "@/integrations/desktop/types";

type Severity = "ok" | "warn" | "error";

interface Check {
  id: string;
  label: string;
  severity: Severity;
  detail: string;
}

/**
 * Etapa 15 — Diagnóstico final offline.
 * Executa uma bateria de verificações antes de liberar uma versão para o
 * cliente e classifica o resultado em "Pronto", "Atenção" ou "Erro crítico".
 */
export function DiagnosticoOfflineCard({
  cfg,
}: {
  cfg?: TerminalConexaoConfig;
}) {
  const [open, setOpen] = useState(false);
  const [rodando, setRodando] = useState(false);
  const [checks, setChecks] = useState<Check[]>([]);
  const [veredito, setVeredito] = useState<Severity | null>(null);

  async function executar() {
    setRodando(true);
    setChecks([]);
    setVeredito(null);
    console.log("[DIAGNOSTIC_RUN] iniciando diagnóstico offline");
    const out: Check[] = [];

    // Coleta em paralelo, tolerando falhas individuais.
    const [
      sqlite,
      daemon,
      backup,
      sync,
      offline,
      dom,
      caixa,
    ] = await Promise.all([
      getLocalSqliteHealth().catch(() => null),
      getLocalServerStatus().catch(() => null),
      fetchBackupStatus(cfg).catch(() => null),
      fetchSyncOverview(cfg).catch(() => null),
      fetchOfflineStatus(cfg).catch(() => null),
      fetchDomainStats(cfg).catch(() => []),
      fetchCaixaLocalAberto(cfg).catch(() => null),
    ]);

    // 1) SQLite
    if (!sqlite) {
      out.push({
        id: "sqlite",
        label: "Banco SQLite",
        severity: "error",
        detail: "Não foi possível ler o status do SQLite local.",
      });
    } else {
      const tamanhoMb = (sqlite.db_size_bytes / 1024 / 1024).toFixed(2);
      out.push({
        id: "sqlite",
        label: "Banco SQLite",
        severity: sqlite.integrity_ok ? "ok" : "error",
        detail: sqlite.integrity_ok
          ? `Integridade OK — ${tamanhoMb} MB, journal ${sqlite.journal_mode}.`
          : `Integridade comprometida: ${sqlite.integrity_detail}.`,
      });
    }

    // 2) Servidor local
    if (!daemon) {
      out.push({
        id: "server",
        label: "Servidor local",
        severity: "warn",
        detail: "Status do servidor local indisponível neste contexto.",
      });
    } else if (daemon.running && daemon.port) {
      out.push({
        id: "server",
        label: "Servidor local",
        severity: "ok",
        detail: `Rodando em ${daemon.hostname ?? "host"}:${daemon.port}.`,
      });
    } else {
      out.push({
        id: "server",
        label: "Servidor local",
        severity: "error",
        detail: "Servidor local parado. Inicie o backend para operar offline.",
      });
    }

    // 3) Backup
    if (!backup) {
      out.push({
        id: "backup",
        label: "Backup local",
        severity: "warn",
        detail: "Status de backup indisponível.",
      });
    } else {
      const ultimo = backup.last_backup_at_ms
        ? new Date(backup.last_backup_at_ms).toLocaleString("pt-BR")
        : null;
      const sev: Severity = ultimo ? "ok" : "warn";
      out.push({
        id: "backup",
        label: "Backup local",
        severity: sev,
        detail: ultimo
          ? `Último backup: ${ultimo}.`
          : "Nenhum backup encontrado. Gere um antes de liberar a versão.",
      });
    }

    // 4) Sincronização agregada
    if (!sync) {
      out.push({
        id: "sync",
        label: "Sincronização com a nuvem",
        severity: "warn",
        detail: "Não foi possível consultar a fila de sincronização.",
      });
    } else {
      const sev: Severity =
        sync.error > 0 || sync.conflict > 0 ? "warn" : "ok";
      out.push({
        id: "sync",
        label: "Sincronização com a nuvem",
        severity: sev,
        detail: `Pendentes ${sync.pending} · enviando ${sync.processing} · sincronizados ${sync.synced} · erros ${sync.error} · conflitos ${sync.conflict}.`,
      });

      // 5) Outboxes pendentes (derivado)
      const totalPend = sync.pending + sync.processing;
      out.push({
        id: "outbox",
        label: "Outboxes pendentes",
        severity: totalPend > 100 ? "warn" : "ok",
        detail:
          totalPend === 0
            ? "Nenhum registro aguardando envio."
            : `${totalPend} registros aguardando sincronização.`,
      });
    }

    // 6) Sync inicial + PIN + produtos/estoque via offline status
    if (!offline) {
      out.push({
        id: "initial",
        label: "Sincronização inicial",
        severity: "error",
        detail: "Status offline indisponível — banco pode não estar pronto.",
      });
    } else {
      out.push({
        id: "initial",
        label: "Sincronização inicial",
        severity: offline.initial_sync_completed ? "ok" : "error",
        detail: offline.initial_sync_completed
          ? "Sincronização inicial concluída."
          : "Sincronização inicial pendente — rode antes de levar ao cliente.",
      });

      const findDom = (key: string) =>
        offline.domains.find((d) => d.domain === key);

      // 7) PIN preparado (via domínio funcionarios/pin)
      const pin =
        findDom("pin_funcionarios") ??
        findDom("funcionarios") ??
        findDom("usuarios_pin");
      out.push({
        id: "pin",
        label: "PIN do PDV preparado",
        severity: pin
          ? pin.ready && pin.row_count > 0
            ? "ok"
            : "warn"
          : offline.initial_sync_completed
            ? "warn"
            : "error",
        detail: pin
          ? `${pin.row_count} usuário(s) com PIN local${pin.last_error ? ` — ${pin.last_error}` : ""}.`
          : "Domínio de PIN não encontrado na sincronização inicial.",
      });

      // 8) Produtos locais
      const prods = findDom("produtos") ?? null;
      const prodFromDomStat = dom.find((d) => d.domain === "produtos");
      const prodCount = prods?.row_count ?? prodFromDomStat?.row_count ?? 0;
      out.push({
        id: "produtos",
        label: "Produtos no cache local",
        severity: prodCount > 0 ? "ok" : "error",
        detail:
          prodCount > 0
            ? `${prodCount} produtos sincronizados localmente.`
            : "Nenhum produto local — PDV offline não vai conseguir vender.",
      });

      // 9) Estoque local
      const estSaldos = findDom("estoque_saldos");
      const estDom = dom.find((d) => d.domain === "estoque_saldos");
      const estCount = estSaldos?.row_count ?? estDom?.row_count ?? 0;
      out.push({
        id: "estoque",
        label: "Estoque no cache local",
        severity: estCount > 0 ? "ok" : "warn",
        detail:
          estCount > 0
            ? `${estCount} saldos de estoque locais.`
            : "Sem saldos de estoque locais — confira a sincronização inicial.",
      });
    }

    // 10) Caixa local
    out.push({
      id: "caixa",
      label: "Caixa local",
      severity: "ok",
      detail: caixa
        ? `Caixa aberto detectado (${caixa.local_uuid?.slice(0, 8)}…).`
        : "Nenhum caixa aberto agora — normal fora de expediente.",
    });

    // Veredito final
    const hasError = out.some((c) => c.severity === "error");
    const hasWarn = out.some((c) => c.severity === "warn");
    const final: Severity = hasError ? "error" : hasWarn ? "warn" : "ok";
    console.log("[DIAGNOSTIC_RUN] concluído", {
      total: out.length,
      veredito: final,
    });

    setChecks(out);
    setVeredito(final);
    setRodando(false);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base">Diagnóstico offline</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Validação rápida antes de liberar uma nova versão para o cliente.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setOpen(true);
            void executar();
          }}
        >
          <Stethoscope className="mr-2 h-4 w-4" />
          Executar diagnóstico offline
        </Button>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">
        Verifica SQLite, servidor local, backup, sincronização, outboxes
        pendentes, sync inicial, PIN, produtos, estoque e caixa local.
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Diagnóstico offline</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center gap-3">
              {rodando && (
                <Badge variant="outline" className="gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Executando…
                </Badge>
              )}
              {!rodando && veredito === "ok" && (
                <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                  Pronto para uso offline
                </Badge>
              )}
              {!rodando && veredito === "warn" && (
                <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30">
                  <AlertTriangle className="mr-1 h-3.5 w-3.5" />
                  Atenção — revise os itens abaixo
                </Badge>
              )}
              {!rodando && veredito === "error" && (
                <Badge variant="destructive">
                  <XCircle className="mr-1 h-3.5 w-3.5" />
                  Erro crítico — não libere ainda
                </Badge>
              )}
            </div>

            <ul className="space-y-2">
              {checks.map((c) => (
                <li
                  key={c.id}
                  className="flex items-start gap-2 rounded-md border bg-card/40 p-2 text-sm"
                >
                  {c.severity === "ok" && (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  )}
                  {c.severity === "warn" && (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  )}
                  {c.severity === "error" && (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  )}
                  <div className="flex-1">
                    <div className="font-medium">{c.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.detail}
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => void executar()}
                disabled={rodando}
              >
                Executar novamente
              </Button>
              <Button onClick={() => setOpen(false)}>Fechar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
