import { useEffect, useState } from "react";
import {
  Database,
  DownloadCloud,
  HardDrive,
  History,
  Loader2,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  agendarRestauracao,
  cancelarRestauracao,
  criarBackupAgora,
  exportarBackup,
  fetchBackupList,
  fetchBackupLog,
  fetchBackupStatus,
  fetchRestorePreflight,
  type BackupFileItem,
  type BackupLogEntry,
  type BackupStatusPayload,
  type RestorePreflight,
} from "@/integrations/desktop/serverConnection";
import type { TerminalConexaoConfig } from "@/integrations/desktop/types";

interface Props {
  cfg: TerminalConexaoConfig;
}

function fmtDate(ms: number | null | undefined) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("pt-BR");
}

function fmtSize(bytes: number | null | undefined) {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/**
 * Bloco de Backup, Restauração e Exportação. Renderiza apenas quando há um
 * servidor local acessível (config válida). Toda lógica crítica vive no
 * backend Rust (`backup.rs`), aqui só consumimos os endpoints HTTP.
 */
export function BackupSeguranca({ cfg }: Props) {
  const [status, setStatus] = useState<BackupStatusPayload | null>(null);
  const [files, setFiles] = useState<BackupFileItem[]>([]);
  const [log, setLog] = useState<BackupLogEntry[]>([]);
  const [preflight, setPreflight] = useState<RestorePreflight | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [restorePath, setRestorePath] = useState("");
  const [restoreConfirmText, setRestoreConfirmText] = useState("");
  const [forceRestore, setForceRestore] = useState(false);
  const [exportSrc, setExportSrc] = useState<string | null>(null);
  const [exportDest, setExportDest] = useState("");

  const recarregar = async () => {
    const [st, fs, lg, pf] = await Promise.all([
      fetchBackupStatus(cfg),
      fetchBackupList(cfg),
      fetchBackupLog(cfg, 30),
      fetchRestorePreflight(cfg),
    ]);
    setStatus(st);
    setFiles(fs);
    setLog(lg);
    setPreflight(pf);
  };

  useEffect(() => {
    void recarregar();
    const t = setInterval(() => void recarregar(), 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.host, cfg.porta]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    setInfo(null);
    try {
      const r = await fn();
      if (r === null || r === false) {
        setError("Operação não retornou sucesso. Verifique o servidor local.");
      } else {
        setInfo(`${label} concluída.`);
      }
      await recarregar();
    } catch (e) {
      setError((e as Error)?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleBackup = () =>
    run("Backup manual", () => criarBackupAgora(cfg, "manual"));

  const handleRestore = async () => {
    const path = restorePath.trim();
    if (!path) {
      setError("Informe o caminho do arquivo .db a restaurar.");
      return;
    }
    if (restoreConfirmText.trim().toUpperCase() !== "RESTAURAR") {
      setError('Digite a palavra "RESTAURAR" para confirmar.');
      return;
    }
    if (preflight?.blocked && !forceRestore) {
      setError(
        "Restauração bloqueada: " +
          (preflight.reasons.join(" | ") || "estado inseguro"),
      );
      return;
    }
    const aviso = preflight?.blocked
      ? "ATENÇÃO: existem pendências (caixa aberto e/ou outbox). Você está forçando o restore como administrador. Um pre-backup automático será criado, mas dados não sincronizados podem ser perdidos. Confirmar?"
      : "Restaurar substituirá o banco atual. Um pre-backup automático será criado e o app precisará ser reiniciado. Deseja continuar?";
    if (!confirm(aviso)) return;
    await run("Restauração agendada", () =>
      agendarRestauracao(cfg, path, { force: forceRestore }),
    );
    setRestoreConfirmText("");
    setForceRestore(false);
  };

  const handleCancelRestore = async () => {
    await run("Restauração cancelada", () => cancelarRestauracao(cfg));
  };

  const handleExport = async () => {
    if (!exportSrc) { setError("Selecione um backup."); return; }
    const dest = exportDest.trim();
    if (!dest) { setError("Informe o caminho de destino."); return; }
    await run("Exportação", () => exportarBackup(cfg, exportSrc, dest));
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          Backup e segurança
        </CardTitle>
        <Button size="sm" variant="outline" onClick={() => void recarregar()}>
          <RotateCw className="mr-2 h-4 w-4" />
          Atualizar
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {status?.restore_pending && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="flex-1">
              <div className="font-semibold">Restauração pendente</div>
              <div className="text-xs">
                Reinicie o aplicativo desktop para concluir a restauração. Um
                pre-backup do estado atual já foi criado.
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCancelRestore}
              disabled={!!busy}
            >
              <XCircle className="mr-2 h-4 w-4" />
              Cancelar
            </Button>
          </div>
        )}

        <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-3 text-xs sm:grid-cols-2">
          <div>
            <div className="text-muted-foreground">Pasta de backups</div>
            <div className="font-mono break-all">{status?.backups_dir ?? "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Banco local</div>
            <div className="font-mono break-all">{status?.db_path ?? "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Último backup</div>
            <div>{fmtDate(status?.last_backup_ms)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Último automático</div>
            <div>{fmtDate(status?.last_auto_backup_ms)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Última restauração</div>
            <div>{fmtDate(status?.last_restore_ms)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">
              Armazenado ({status?.total_backups ?? 0} arquivos)
            </div>
            <div>{fmtSize(status?.total_size_bytes)}</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleBackup} disabled={!!busy}>
            {busy === "Backup manual" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Database className="mr-2 h-4 w-4" />
            )}
            Criar backup agora
          </Button>
        </div>

        {error && (
          <div className="rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-600 dark:text-red-400">
            {error}
          </div>
        )}
        {info && (
          <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-700 dark:text-emerald-400">
            {info}
          </div>
        )}

        {/* Lista de backups */}
        <div className="rounded-lg border border-border">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <HardDrive className="h-4 w-4" />
              Backups armazenados
            </div>
            <Badge variant="secondary">
              retenção auto: {status?.auto_retention ?? 14}
            </Badge>
          </div>
          {files.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              Nenhum backup ainda — crie o primeiro acima.
            </div>
          ) : (
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Arquivo</th>
                    <th className="px-3 py-2 text-left font-medium">Tipo</th>
                    <th className="px-3 py-2 text-left font-medium">Quando</th>
                    <th className="px-3 py-2 text-right font-medium">Tamanho</th>
                    <th className="px-3 py-2 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => {
                    const variant: "default" | "secondary" | "outline" =
                      f.kind === "auto" ? "secondary"
                      : f.kind === "manual" ? "default"
                      : "outline";
                    const isExportSrc = exportSrc === f.path;
                    return (
                      <tr key={f.path} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-[11px]">
                          {f.name}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={variant}>{f.kind}</Badge>
                        </td>
                        <td className="px-3 py-2">{fmtDate(f.modified_ms)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmtSize(f.size_bytes)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant={isExportSrc ? "default" : "outline"}
                              onClick={() => setExportSrc(f.path)}
                              title="Selecionar para exportar"
                            >
                              <UploadCloud className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setRestorePath(f.path)}
                              title="Usar este caminho na restauração"
                            >
                              <DownloadCloud className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Exportar */}
        <div className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <UploadCloud className="h-4 w-4" />
            Exportar cópia de segurança
          </div>
          <div className="space-y-2 text-xs">
            <div>
              <span className="text-muted-foreground">Origem:</span>{" "}
              <span className="font-mono">{exportSrc ?? "selecione um backup acima"}</span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                placeholder="Caminho de destino (ex.: D:\\Backups\\gestao-pro.db)"
                value={exportDest}
                onChange={(e) => setExportDest(e.target.value)}
              />
              <Button
                onClick={handleExport}
                disabled={!!busy || !exportSrc || !exportDest.trim()}
              >
                Exportar
              </Button>
            </div>
            <div className="text-muted-foreground">
              Copia o arquivo selecionado para o caminho indicado (HD externo,
              pendrive ou pasta de rede). Não altera o banco em uso.
            </div>
          </div>
        </div>

        {/* Restaurar */}
        <div className="rounded-lg border border-amber-300/40 bg-amber-500/5 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            <DownloadCloud className="h-4 w-4" />
            Restaurar backup
          </div>

          {/* Preflight de segurança (PROMPT 15) */}
          {preflight && (
            <div
              className={`mb-3 rounded-md border p-2 text-xs ${
                preflight.blocked
                  ? "border-destructive/50 bg-destructive/10 text-destructive"
                  : "border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              }`}
            >
              <div className="font-semibold">
                {preflight.blocked
                  ? "Restore bloqueado pelo preflight"
                  : "Pronto para restaurar"}
              </div>
              <ul className="mt-1 list-inside list-disc">
                <li>
                  Caixa aberto: {preflight.caixa_abertos_count > 0 ? `sim (${preflight.caixa_abertos_count})` : "não"}
                </li>
                <li>Outbox pendente: {preflight.outbox_pending_total}</li>
                <li>Outbox com erro: {preflight.outbox_error_total}</li>
              </ul>
              {preflight.reasons.length > 0 && (
                <ul className="mt-1 list-inside list-disc">
                  {preflight.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="space-y-2 text-xs">
            <Input
              placeholder="Caminho do arquivo .db a restaurar"
              value={restorePath}
              onChange={(e) => setRestorePath(e.target.value)}
            />
            <Input
              placeholder='Digite "RESTAURAR" para confirmar'
              value={restoreConfirmText}
              onChange={(e) => setRestoreConfirmText(e.target.value)}
            />
            {preflight?.blocked && (
              <label className="flex items-center gap-2 text-destructive">
                <input
                  type="checkbox"
                  checked={forceRestore}
                  onChange={(e) => setForceRestore(e.target.checked)}
                />
                Forçar restore como administrador (registrado em auditoria)
              </label>
            )}
            <div className="flex justify-end">
              <Button
                variant="destructive"
                onClick={handleRestore}
                disabled={
                  !!busy ||
                  !restorePath.trim() ||
                  restoreConfirmText.trim().toUpperCase() !== "RESTAURAR" ||
                  (preflight?.blocked === true && !forceRestore)
                }
              >
                Restaurar
              </Button>
            </div>
            <div className="text-muted-foreground">
              Antes da restauração: validamos o arquivo, criamos um pre-backup
              do estado atual e agendamos o swap atômico para o próximo boot.
              Depois, basta reiniciar o app. Todas as tentativas (incluindo
              negadas e forçadas) ficam registradas no histórico abaixo.
            </div>
          </div>
        </div>


        {/* Histórico */}
        <div className="rounded-lg border border-border">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <History className="h-4 w-4" />
            Histórico recente
          </div>
          {log.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              Nenhum evento registrado ainda.
            </div>
          ) : (
            <div className="max-h-56 overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Quando</th>
                    <th className="px-3 py-2 text-left font-medium">Operação</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                    <th className="px-3 py-2 text-left font-medium">Detalhe</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((e) => (
                    <tr key={e.id} className="border-t border-border">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {fmtDate(e.created_at_ms)}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="outline">{e.kind}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={
                            e.status === "ok" || e.status === "applied"
                              ? "default"
                              : e.status === "error"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {e.status}
                        </Badge>
                      </td>
                      <td
                        className="px-3 py-2 font-mono text-[11px] text-muted-foreground"
                        title={e.path}
                      >
                        {e.message ?? e.path.split(/[\\/]/).pop()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Backup automático: 1× por dia, com retenção dos últimos{" "}
          {status?.auto_retention ?? 14}. Endpoints:{" "}
          <code>/backup/status</code>, <code>/backup/list</code>,{" "}
          <code>/backup/log</code>, <code>/backup/create</code>,{" "}
          <code>/backup/export</code>, <code>/backup/restore/schedule</code>.
        </p>
      </CardContent>
    </Card>
  );
}
