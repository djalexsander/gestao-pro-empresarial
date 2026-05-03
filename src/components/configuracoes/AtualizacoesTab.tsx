import { useEffect, useState } from "react";
import { Download, Loader2, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";

/**
 * Bloco de Atualização do App Desktop.
 *
 * Usa `@tauri-apps/plugin-updater` para consultar o endpoint configurado em
 * `tauri.conf.json` (plugins.updater.endpoints) e fazer download/install
 * verificados pela chave pública (assinatura). O reinício é feito via
 * `@tauri-apps/plugin-process`.
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
  } | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const verificar = async () => {
    setError(null);
    setAvailable(null);
    setChecking(true);
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      setLastChecked(new Date());
      if (update) {
        setAvailable({
          version: update.version,
          date: update.date ?? null,
          notes: update.body ?? null,
        });
      } else {
        toast.success("Você está na versão mais recente.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
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
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (!update) {
        toast.info("Sem nova versão disponível.");
        setInstalling(false);
        return;
      }
      let received = 0;
      let total: number | null = null;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? null;
            setContentLength(total);
            break;
          case "Progress":
            received += event.data.chunkLength;
            setDownloaded(received);
            if (total) setProgress(Math.min(100, (received / total) * 100));
            break;
          case "Finished":
            setProgress(100);
            break;
        }
      });
      toast.success("Atualização instalada. Reiniciando…");
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(`Falha ao atualizar: ${msg}`);
      setInstalling(false);
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
                <div className="text-[11px] text-muted-foreground">
                  {contentLength
                    ? `${(downloaded / 1024 / 1024).toFixed(1)} / ${(
                        contentLength / 1024 / 1024
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
      </CardContent>
    </Card>
  );
}
