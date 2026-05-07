import { useState, useEffect } from "react";
import { Download, Loader2, RefreshCw, ShieldCheck, Sparkles, WifiOff, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  useAppUpdate,
  loadUpdatePrefs,
  saveUpdatePrefs,
  type UpdatePrefs,
  type UpdateChannel,
} from "@/hooks/useAppUpdate";

/**
 * Bloco de Atualização do App Desktop em Configurações > Desktop.
 *
 * Reusa o hook `useAppUpdate` (mesmo do banner global) para manter um único
 * estado consistente: verificação automática a cada 30min, download/install
 * assinados via Tauri Updater, reinício via plugin-process.
 *
 * Adiciona preferências persistidas em localStorage:
 *   - verificar automaticamente
 *   - baixar automaticamente
 *   - canal (estável / beta / dev)
 *
 * Na web, exibe estado degradado (sem ações de instalar binário).
 */
export function AtualizacoesTab() {
  const upd = useAppUpdate();
  const [prefs, setPrefs] = useState<UpdatePrefs>(() => loadUpdatePrefs());

  useEffect(() => {
    saveUpdatePrefs(prefs);
  }, [prefs]);

  const updatePref = <K extends keyof UpdatePrefs>(key: K, value: UpdatePrefs[K]) => {
    setPrefs((p) => ({ ...p, [key]: value }));
  };

  const handleVerificar = async () => {
    if (!upd.online) {
      toast.error("Sem conexão para verificar atualizações.");
      return;
    }
    await upd.check();
    if (!upd.newVersion && upd.status !== "error") {
      toast.success("Você está na versão mais recente.");
    }
  };

  if (!upd.isTauri) {
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

  const sizeMb =
    upd.contentLength != null
      ? `${(upd.downloaded / 1024 / 1024).toFixed(1)} / ${(upd.contentLength / 1024 / 1024).toFixed(1)} MB`
      : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> Atualizações do app desktop
        </CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono">
            v{upd.currentVersion ?? "—"}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleVerificar()}
            disabled={upd.status === "checking" || upd.isApplying || !upd.online}
          >
            {upd.status === "checking" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-1">Verificar</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
          Atualizações são assinadas digitalmente e verificadas antes de instalar.
        </div>

        {!upd.online && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400">
            <WifiOff className="h-3.5 w-3.5" />
            Sem conexão para verificar atualizações.
          </div>
        )}

        {upd.lastChecked && (
          <div className="text-xs text-muted-foreground">
            Última verificação: {upd.lastChecked.toLocaleString("pt-BR")}
          </div>
        )}

        {upd.error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
            {upd.error}
          </div>
        )}

        {upd.newVersion ? (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium">
                  Nova versão disponível: v{upd.newVersion}
                </div>
                {upd.releaseDate && (
                  <div className="text-xs text-muted-foreground">
                    Publicada em {upd.releaseDate}
                  </div>
                )}
              </div>
              {upd.status === "ready" ? (
                <Button size="sm" onClick={() => void upd.restart()}>
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="ml-1">Reiniciar</span>
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => void upd.applyUpdate()}
                  disabled={upd.isApplying}
                >
                  {upd.isApplying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  <span className="ml-1">
                    {upd.status === "downloading"
                      ? "Baixando…"
                      : upd.status === "installing"
                        ? "Instalando…"
                        : "Baixar e instalar"}
                  </span>
                </Button>
              )}
            </div>

            {upd.releaseNotes && (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-background/60 p-2 text-xs">
                {upd.releaseNotes}
              </pre>
            )}

            {(upd.status === "downloading" || upd.status === "installing") && (
              <div className="space-y-1">
                <Progress value={upd.progress} />
                <div className="text-[11px] text-muted-foreground">
                  {sizeMb ?? "Baixando…"} · {Math.round(upd.progress)}%
                </div>
              </div>
            )}
          </div>
        ) : (
          upd.status !== "checking" && (
            <div className="text-xs text-muted-foreground">
              Nenhuma atualização pendente. Use “Verificar” para checar agora.
            </div>
          )
        )}

        {/* Preferências */}
        <div className="space-y-3 rounded-md border bg-background/40 p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Preferências
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="upd-auto-check" className="flex flex-col gap-0.5 text-sm">
              <span>Verificar atualizações automaticamente</span>
              <span className="text-xs text-muted-foreground">
                Ao abrir o app e a cada 30 minutos.
              </span>
            </Label>
            <Switch
              id="upd-auto-check"
              checked={prefs.autoCheck}
              onCheckedChange={(v) => updatePref("autoCheck", v)}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="upd-auto-dl" className="flex flex-col gap-0.5 text-sm">
              <span>Baixar automaticamente</span>
              <span className="text-xs text-muted-foreground">
                Baixa em segundo plano e pede só para instalar.
              </span>
            </Label>
            <Switch
              id="upd-auto-dl"
              checked={prefs.autoDownload}
              onCheckedChange={(v) => updatePref("autoDownload", v)}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="upd-channel" className="flex flex-col gap-0.5 text-sm">
              <span>Canal de atualização</span>
              <span className="text-xs text-muted-foreground">
                Estável é o recomendado para produção.
              </span>
            </Label>
            <Select
              value={prefs.channel}
              onValueChange={(v) => updatePref("channel", v as UpdateChannel)}
            >
              <SelectTrigger id="upd-channel" className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stable">Estável</SelectItem>
                <SelectItem value="beta">Beta</SelectItem>
                <SelectItem value="dev">Desenvolvimento</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
