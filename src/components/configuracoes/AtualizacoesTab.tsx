import { useEffect, useState } from "react";
import {
  ClipboardCopy,
  Download,
  FileText,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { getDiagnosticLogPath, readDiagnosticLog } from "@/lib/desktopErrorLogger";
import { checkDesktopUpdate, downloadInstallAndRelaunch, formatUpdaterError, type DesktopUpdate, type UpdaterPhase } from "@/lib/tauriUpdater";

/**
 * Bloco de Atualização do App Desktop.
 *
 * Usa `@tauri-apps/plugin-updater` para consultar o endpoint configurado em
 * `tauri.conf.json` (plugins.updater.endpoints) e fazer download/install
 * verificados pela chave pública (assinatura). O reinício é feito via
 * pelo instalador NSIS iniciado pelo updater.
 *
 * Renderiza somente quando rodando dentro do Tauri (desktop). Na web fica
 * inerte — o módulo de atualização só faz sentido no app instalado.
 */
export function AtualizacoesTab() {
  const [isTauri, setIsTauri] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<string>("—");
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [downloaded, setDownloaded] = useState(0);
  const [contentLength, setContentLength] = useState<number | null>(null);
  const [available, setAvailable] = useState<{
    version: string;
    date?: string | null;
    notes?: string | null;
    update: DesktopUpdate;
  } | null>(null);
  const [installPhase, setInstallPhase] = useState<UpdaterPhase | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diagnosticText, setDiagnosticText] = useState<string | null>(null);
  const [diagnosticPath, setDiagnosticPath] = useState<string | null>(null);
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);

  useEffect(() => {
    const inTauri =
      typeof window !== "undefined" &&
      // @ts-expect-error - injected by Tauri runtime
      (Boolean(window.__TAURI_INTERNALS__) || Boolean(window.__TAURI__));
    setIsTauri(inTauri);
    if (!inTauri) return;
    void (async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        setCurrentVersion(await getVersion());
      } catch (versionError) {
        console.warn("[updater] Não foi possível obter a versão atual:", formatUpdaterError(versionError));
      }
    })();
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    void getDiagnosticLogPath()
      .then(setDiagnosticPath)
      .catch(() => undefined);
  }, [isTauri]);

  const carregarDiagnostico = async () => {
    setDiagnosticLoading(true);
    try {
      const text = await readDiagnosticLog();
      setDiagnosticText(text || "Nenhum diagnóstico registrado até o momento.");
      setDiagnosticPath(await getDiagnosticLogPath());
    } catch (e) {
      toast.error(`Falha ao ler diagnóstico: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDiagnosticLoading(false);
    }
  };

  const copiarDiagnostico = async () => {
    try {
      const text = diagnosticText ?? (await readDiagnosticLog());
      if (!text) {
        toast.info("Nenhum diagnóstico registrado até o momento.");
        return;
      }
      await navigator.clipboard.writeText(text);
      setDiagnosticText(text);
      toast.success("Diagnóstico copiado.");
    } catch (e) {
      toast.error(`Falha ao copiar diagnóstico: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const verificar = async () => {
    setError(null);
    setAvailable(null);
    setChecking(true);
    try {
      const { update, currentVersion: detectedVersion } = await checkDesktopUpdate();
      setCurrentVersion(detectedVersion);
      setLastChecked(new Date());
      if (update) {
        setAvailable({
          version: update.version,
          date: update.date ?? null,
          notes: update.body ?? null,
          update,
        });
      } else {
        toast.success("Você está na versão mais recente.");
      }
    } catch (e) {
      const msg = formatUpdaterError(e);
      setError(msg);
      toast.error(`Falha ao verificar atualizações: ${msg}`);
    } finally {
      setChecking(false);
    }
  };

  const baixarEInstalar = async () => {
    setError(null);
    setInstalling(true);
    setProgress(0);
    setDownloaded(0);
    setContentLength(null);
    setInstallPhase("checking");
    try {
      const update = available?.update ?? (await checkDesktopUpdate()).update;
      if (!update) {
        toast.info("Sem nova versão disponível.");
        setInstalling(false);
        setInstallPhase(null);
        return;
      }
      await downloadInstallAndRelaunch({
        update,
        onProgress: (state) => {
          setInstallPhase(state.phase);
          setDownloaded(state.downloadedBytes);
          setContentLength(state.totalBytes);
          if (state.totalBytes) {
            setProgress(Math.min(100, (state.downloadedBytes / state.totalBytes) * 100));
          }
        },
      });
      setInstalling(false);
      setInstallPhase(null);
    } catch (e) {
      const msg = formatUpdaterError(e);
      setError(msg);
      toast.error(`Falha ao atualizar: ${msg}`);
      setInstalling(false);
      setInstallPhase(null);
      setProgress(null);
      setDownloaded(0);
      setContentLength(null);
    }
  };

  if (!isTauri) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Atualizações do app desktop
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Esta seção controla atualizações do <strong>aplicativo instalado</strong>{" "}
          (Windows/macOS/Linux). Disponível apenas dentro do Gestão Pro Desktop.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> Atualizações do app desktop
        </CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono">
            v{currentVersion}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void verificar()}
            disabled={checking || installing}
          >
            {checking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-1">Verificar</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
          Atualizações são assinadas digitalmente e verificadas antes de instalar.
        </div>

        {lastChecked && (
          <div className="text-xs text-muted-foreground">
            Última verificação: {lastChecked.toLocaleString("pt-BR")}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {available ? (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">
                  Nova versão disponível: v{available.version}
                </div>
                {available.date && (
                  <div className="text-xs text-muted-foreground">
                    Publicada em {available.date}
                  </div>
                )}
              </div>
              <Button
                size="sm"
                onClick={() => void baixarEInstalar()}
                disabled={installing}
              >
                {installing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                <span className="ml-1">
                  {installing ? "Instalando…" : "Baixar e instalar"}
                </span>
              </Button>
            </div>
            {available.notes && (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-background/60 p-2 text-xs">
                {available.notes}
              </pre>
            )}
            {installing && (
              <div className="space-y-1">
                <Progress value={progress ?? 0} />
                <div className="text-xs font-medium">
                  {installPhase === "checking" && "Verificando atualização…"}
                  {installPhase === "downloading" && "Baixando atualização…"}
                  {installPhase === "validating-installing" && "Validando assinatura e iniciando instalação…"}
                  {installPhase === "relaunching" && "Instalação concluída; reiniciando aplicativo…"}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {contentLength
                    ? `${(downloaded / 1024 / 1024).toFixed(1)} / ${(
                        contentLength /
                        1024 /
                        1024
                      ).toFixed(1)} MB`
                    : "Baixando…"}
                </div>
              </div>
            )}
          </div>
        ) : (
          !checking && (
            <div className="text-xs text-muted-foreground">
              Nenhuma atualização pendente. Use “Verificar” para checar agora.
            </div>
          )
        )}
        <div className="space-y-2 rounded-md border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 font-medium">
                <FileText className="h-4 w-4" /> Diagnóstico de inicialização
              </div>
              {diagnosticPath && (
                <div className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                  {diagnosticPath}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void carregarDiagnostico()}
                disabled={diagnosticLoading}
              >
                {diagnosticLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                <span className="ml-1">Visualizar</span>
              </Button>
              <Button size="sm" variant="outline" onClick={() => void copiarDiagnostico()}>
                <ClipboardCopy className="h-4 w-4" />
                <span className="ml-1">Copiar</span>
              </Button>
            </div>
          </div>
          {diagnosticText !== null && (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-background p-2 font-mono text-[11px]">
              {diagnosticText}
            </pre>
          )}
          <p className="text-[11px] text-muted-foreground">
            O arquivo contém somente contexto técnico, nomes de chaves de storage e pilhas de erro;
            valores de storage não são registrados.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
