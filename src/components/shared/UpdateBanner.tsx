import { useState } from "react";
import { useAppUpdate } from "@/hooks/useAppUpdate";
import { useLocation } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sparkles, RefreshCw, X, Loader2, CheckCircle2, Download, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Banner moderno e discreto para atualizações de versão (web + Tauri desktop).
 * Esconde-se durante operação ativa do PDV para não atrapalhar venda — o
 * usuário continua podendo atualizar pelas Configurações.
 */
export function UpdateBanner() {
  const upd = useAppUpdate();
  const location = useLocation();
  const [showNotes, setShowNotes] = useState(false);

  // Não atrapalhar venda no PDV — mas se já está baixando/pronto, mostra mesmo.
  const inPdv = location.pathname.startsWith("/pdv");
  if (inPdv && upd.status === "available") return null;

  if (!upd.updateAvailable && upd.status !== "error") return null;
  if (upd.status === "error" && !upd.newVersion) return null;

  const sizeMb =
    upd.contentLength != null
      ? `${(upd.downloaded / 1024 / 1024).toFixed(1)} / ${(upd.contentLength / 1024 / 1024).toFixed(1)} MB`
      : null;

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "fixed z-[100] left-3 right-3 bottom-3 sm:left-auto sm:right-4 sm:bottom-4 sm:w-[400px]",
          "animate-in fade-in slide-in-from-bottom-4 duration-300",
        )}
      >
        <div
          className={cn(
            "relative overflow-hidden rounded-xl border border-border/60 bg-card/95 backdrop-blur-md",
            "shadow-2xl shadow-primary/10",
          )}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -top-16 -right-16 h-32 w-32 rounded-full bg-primary/15 blur-2xl"
          />

          {upd.status !== "downloading" && upd.status !== "installing" && upd.status !== "ready" && (
            <button
              type="button"
              onClick={upd.dismiss}
              aria-label="Fechar"
              className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}

          <div className="flex items-start gap-3 p-4 pr-9">
            <div
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                upd.status === "ready"
                  ? "bg-emerald-500/15 text-emerald-600"
                  : upd.status === "error"
                    ? "bg-destructive/15 text-destructive"
                    : "bg-primary/15 text-primary",
              )}
            >
              {upd.status === "ready" ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : upd.status === "error" ? (
                <AlertTriangle className="h-5 w-5" />
              ) : (
                <Sparkles className="h-5 w-5" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              {upd.status === "ready" ? (
                <>
                  <p className="text-sm font-semibold leading-tight text-foreground">
                    Atualização instalada com sucesso
                  </p>
                  <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
                    Reinicie o aplicativo para aplicar as melhorias.
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => void upd.restart()}
                      className="h-8 gap-1.5 px-3 text-[13px]"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Reiniciar aplicativo
                    </Button>
                  </div>
                </>
              ) : upd.status === "downloading" || upd.status === "installing" ? (
                <>
                  <p className="text-sm font-semibold leading-tight text-foreground">
                    {upd.status === "installing" ? "Instalando atualização…" : "Baixando atualização…"}
                  </p>
                  <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                    {upd.newVersion ? `v${upd.newVersion}` : ""} {sizeMb ? `· ${sizeMb}` : ""}
                  </p>
                  <div className="mt-2 space-y-1">
                    <Progress value={upd.progress} />
                    <div className="text-[11px] text-muted-foreground">
                      {Math.round(upd.progress)}%
                    </div>
                  </div>
                </>
              ) : upd.status === "error" ? (
                <>
                  <p className="text-sm font-semibold leading-tight text-foreground">
                    Falha ao atualizar
                  </p>
                  <p className="mt-1 text-[12px] leading-snug text-muted-foreground line-clamp-3">
                    {upd.error ?? "Tente novamente em instantes."}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void upd.applyUpdate()}
                      className="h-8 gap-1.5 px-3 text-[13px]"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Tentar novamente
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold leading-tight text-foreground">
                    Nova versão disponível
                    {upd.newVersion ? `: v${upd.newVersion}` : ""}
                  </p>
                  <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
                    {upd.currentVersion
                      ? `Você está em v${upd.currentVersion}. `
                      : ""}
                    Atualize para receber melhorias e correções.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => void upd.applyUpdate()}
                      disabled={upd.isApplying}
                      className="h-8 gap-1.5 px-3 text-[13px]"
                    >
                      {upd.isApplying ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Atualizando…
                        </>
                      ) : (
                        <>
                          <Download className="h-3.5 w-3.5" />
                          Atualizar agora
                        </>
                      )}
                    </Button>
                    {upd.releaseNotes && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShowNotes(true)}
                        disabled={upd.isApplying}
                        className="h-8 px-3 text-[13px]"
                      >
                        Ver novidades
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={upd.snooze}
                      disabled={upd.isApplying}
                      className="h-8 px-3 text-[13px] text-muted-foreground hover:text-foreground"
                    >
                      Depois
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={showNotes} onOpenChange={setShowNotes}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Novidades da versão {upd.newVersion ? `v${upd.newVersion}` : ""}
            </DialogTitle>
            {upd.releaseDate && (
              <DialogDescription>Publicada em {upd.releaseDate}</DialogDescription>
            )}
          </DialogHeader>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs leading-relaxed">
            {upd.releaseNotes ?? "Sem notas disponíveis."}
          </pre>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowNotes(false)}>
              Fechar
            </Button>
            <Button
              onClick={() => {
                setShowNotes(false);
                void upd.applyUpdate();
              }}
              disabled={upd.isApplying}
            >
              <Download className="mr-1.5 h-4 w-4" />
              Atualizar agora
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
