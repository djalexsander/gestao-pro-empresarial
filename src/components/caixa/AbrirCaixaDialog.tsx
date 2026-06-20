import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Power, Loader2 } from "lucide-react";
import { useAbrirCaixa } from "@/hooks/useCaixa";
import { useTerminal } from "@/components/auth/TerminalProvider";
import { useCaixaExitGuard } from "@/components/caixa/CaixaExitGuardProvider";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAberto?: (caixaId: string) => void;
  /** ID do funcionário operando o caixa. Quando ausente, abre como admin. */
  operadorId?: string | null;
  /** Força um terminal específico (PDV). Se ausente, usa o terminal global selecionado. */
  terminalId?: string | null;
}

export function AbrirCaixaDialog({ open, onOpenChange, onAberto, operadorId, terminalId }: Props) {
  const [valor, setValor] = useState("0");
  const [observacao, setObservacao] = useState("");
  const abrir = useAbrirCaixa();
  const { terminal } = useTerminal();
  const { markCaixaAberto } = useCaixaExitGuard();
  const terminalEfetivo = terminalId ?? terminal?.id ?? null;

  useEffect(() => {
    if (open) {
      setValor("0");
      setObservacao("");
    }
  }, [open]);

  async function handleConfirmar(e: React.FormEvent) {
    e.preventDefault();
    const valorNum = Number(valor.replace(",", "."));
    if (Number.isNaN(valorNum) || valorNum < 0) return;
    const id = await abrir.mutateAsync({
      valor_inicial: valorNum,
      observacao: observacao.trim() || null,
      operador_id: operadorId ?? null,
      terminal_id: terminalEfetivo,
    });
    markCaixaAberto();
    onAberto?.(id);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-success/15 text-success">
            <Power className="h-6 w-6" />
          </div>
          <DialogTitle className="text-center">Abrir caixa</DialogTitle>
          <DialogDescription className="text-center">
            Informe o valor inicial em dinheiro disponível na gaveta para troco.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleConfirmar} className="space-y-4">
          {terminal && (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Terminal: <span className="font-medium text-foreground">{terminal.nome}</span>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="valor-inicial">Valor inicial (troco)</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                R$
              </span>
              <Input
                id="valor-inicial"
                type="text"
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                className="pl-10 font-mono text-lg tabular-nums"
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="abertura-obs">Observação (opcional)</Label>
            <Textarea
              id="abertura-obs"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Ex: troco em notas de R$ 5 e R$ 10"
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={abrir.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={abrir.isPending}>
              {abrir.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Abrindo...
                </>
              ) : (
                <>
                  <Power className="h-4 w-4" /> Abrir caixa
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
