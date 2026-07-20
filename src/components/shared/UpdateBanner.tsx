import { useAppUpdate } from "@/hooks/useAppUpdate";
import { Button } from "@/components/ui/button";
import { Sparkles, RefreshCw, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Banner discreto e moderno que avisa quando há nova versão do app.
 * - Fixo no canto inferior direito (canto inferior em telas pequenas).
 * - Botões: "Atualizar agora", "Depois" e fechar opcional.
 * - "Depois" silencia por 10 minutos; depois reaparece se ainda houver atualização.
 */
export function UpdateBanner() {
  const { updateAvailable, isApplying, newVersion, updateError, applyUpdate, snooze, dismiss } = useAppUpdate();

  if (!updateAvailable) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed z-[100] left-3 right-3 bottom-3 sm:left-auto sm:right-4 sm:bottom-4 sm:w-[380px]",
        "animate-in fade-in slide-in-from-bottom-4 duration-300",
      )}
    >
      <div
        className={cn(
          "relative overflow-hidden rounded-xl border border-border/60 bg-card/95 backdrop-blur-md",
          "shadow-2xl shadow-primary/10",
        )}
      >
        {/* gradient acent */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-16 -right-16 h-32 w-32 rounded-full bg-primary/15 blur-2xl"
        />

        <button
          type="button"
          onClick={dismiss}
          aria-label="Fechar"
          className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-start gap-3 p-4 pr-9">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Sparkles className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight text-foreground">
              Nova atualização disponível
            </p>
            <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
              {newVersion
                ? `Versão v${newVersion} disponível.`
                : "Atualize agora para receber melhorias e correções."}
            </p>
            {updateError && (
              <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                Não foi possível instalar a atualização: {updateError}
              </div>
            )}

            <div className="mt-3 flex items-center gap-2">
              <Button
                size="sm"
                onClick={applyUpdate}
                disabled={isApplying}
                className="h-8 gap-1.5 px-3 text-[13px]"
              >
                {isApplying ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Atualizando…
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3.5 w-3.5" />
                    Atualizar agora
                  </>
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={snooze}
                disabled={isApplying}
                className="h-8 px-3 text-[13px] text-muted-foreground hover:text-foreground"
              >
                Depois
              </Button>
            </div>
          </div>
        </div>

        {isApplying && (
          <div className="h-0.5 w-full overflow-hidden bg-muted">
            <div className="h-full w-1/2 animate-[indeterminate_1.2s_ease-in-out_infinite] bg-primary" />
          </div>
        )}
      </div>

      <style>{`
        @keyframes indeterminate {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(50%); }
          100% { transform: translateX(200%); }
        }
      `}</style>
    </div>
  );
}
