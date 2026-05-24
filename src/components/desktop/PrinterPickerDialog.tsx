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
import { Badge } from "@/components/ui/badge";
import { Loader2, Printer, RotateCcw, AlertTriangle, FileText } from "lucide-react";
import { toast } from "sonner";
import { listPrinters, type PrinterInfo } from "@/integrations/desktop/printers";
import { imprimirTeste, friendlyPrintError } from "@/lib/cupom-print";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Nome atual já configurado (para destacar). */
  currentName?: string | null;
  /**
   * Mensagem opcional no topo (ex.: "Impressora salva indisponível"
   * quando reaberto após falha de impressão).
   */
  warning?: string | null;
  /** Callback quando usuário confirma. Recebe o nome escolhido. */
  onSelect: (name: string) => void;
}

export function PrinterPickerDialog({
  open,
  onOpenChange,
  currentName,
  warning,
  onSelect,
}: Props) {
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(currentName ?? null);
  const [testing, setTesting] = useState(false);

  async function testarImpressao() {
    if (!selected) {
      toast.error("Selecione uma impressora para testar.");
      return;
    }
    setTesting(true);
    try {
      const r = await imprimirTeste(selected);
      if (r.ok) toast.success(`Teste enviado para "${selected}".`);
      else toast.error(r.message);
    } finally {
      setTesting(false);
    }
  }

  const carregar = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listPrinters();
      setPrinters(list);
      if (!selected && list.length) {
        const def = list.find((p) => p.is_default) ?? list[0];
        setSelected(def.name);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao listar impressoras.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setSelected(currentName ?? null);
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function confirmar() {
    if (!selected) {
      toast.error("Selecione uma impressora.");
      return;
    }
    onSelect(selected);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" /> Escolher impressora
          </DialogTitle>
          <DialogDescription>
            Esta impressora ficará salva como padrão deste terminal e será usada
            automaticamente nas próximas vendas.
          </DialogDescription>
        </DialogHeader>

        {warning && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{friendlyPrintError(warning)}</span>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Disponíveis no sistema
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void carregar()}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              Atualizar
            </Button>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {!loading && !error && printers.length === 0 && (
            <div className="rounded-md border border-border bg-muted/40 p-4 text-center text-sm text-muted-foreground">
              Nenhuma impressora detectada neste computador.
            </div>
          )}

          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {printers.map((p) => {
              const ativo = selected === p.name;
              return (
                <li key={p.name}>
                  <button
                    type="button"
                    onClick={() => setSelected(p.name)}
                    className={`flex w-full items-center justify-between rounded-md border p-3 text-left text-sm transition ${
                      ativo
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-accent"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{p.name}</div>
                      {p.status && (
                        <div className="text-xs text-muted-foreground">
                          {p.status}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {p.is_default && (
                        <Badge variant="secondary" className="text-[10px]">
                          padrão SO
                        </Badge>
                      )}
                      {ativo && (
                        <Badge className="text-[10px]">selecionada</Badge>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="outline"
            onClick={() => void testarImpressao()}
            disabled={!selected || testing || loading}
          >
            {testing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileText className="mr-2 h-4 w-4" />
            )}
            Imprimir teste
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={confirmar} disabled={!selected || loading}>
              Salvar como padrão
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
