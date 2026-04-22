import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Monitor } from "lucide-react";
import { useTerminaisAtivos } from "@/hooks/useTerminais";
import { useTerminal } from "@/components/auth/TerminalProvider";

/**
 * Tela de seleção de terminal exibida no /pos antes do PIN do operador.
 * Salva a escolha em localStorage para esse dispositivo.
 */
export function TerminalSelector() {
  const { data: terminais = [], isLoading } = useTerminaisAtivos();
  const { setTerminal } = useTerminal();

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (terminais.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Nenhum terminal cadastrado. Peça ao administrador para cadastrar em
        Configurações → Terminais.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-center text-sm text-muted-foreground">
        Selecione qual caixa físico este dispositivo representa.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {terminais.map((t) => (
          <Card
            key={t.id}
            className="cursor-pointer p-4 transition-all hover:border-primary hover:shadow-md"
            onClick={() => setTerminal({ id: t.id, nome: t.nome })}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Monitor className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{t.nome}</p>
                {t.descricao && (
                  <p className="truncate text-xs text-muted-foreground">{t.descricao}</p>
                )}
              </div>
              {t.caixa_aberto_id && (
                <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                  Em uso
                </span>
              )}
            </div>
          </Card>
        ))}
      </div>
      <p className="text-center text-[11px] text-muted-foreground">
        Sua escolha fica salva neste dispositivo.
      </p>
    </div>
  );
}

export function TerminalAtualBadge() {
  const { terminal, limparTerminal } = useTerminal();
  if (!terminal) return null;
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs">
      <Monitor className="h-3.5 w-3.5 text-primary" />
      <span className="font-medium">{terminal.nome}</span>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-1.5 text-[11px]"
        onClick={limparTerminal}
      >
        Trocar
      </Button>
    </div>
  );
}
