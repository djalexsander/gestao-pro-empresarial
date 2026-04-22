import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { useCancelarVenda } from "@/hooks/useVendas";
import { formatBRL } from "@/lib/mock-data";

interface CancelarVendaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  venda: { id: string; numero: string; total: number } | null;
  onCancelled?: () => void;
}

export function CancelarVendaDialog({
  open,
  onOpenChange,
  venda,
  onCancelled,
}: CancelarVendaDialogProps) {
  const [motivo, setMotivo] = useState("");
  const cancelar = useCancelarVenda();

  function handleConfirmar() {
    if (!venda) return;
    cancelar.mutate(
      { venda_id: venda.id, motivo: motivo || null },
      {
        onSuccess: () => {
          setMotivo("");
          onOpenChange(false);
          onCancelled?.();
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !cancelar.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/15 text-destructive">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <DialogTitle className="text-center">
            Cancelar venda {venda?.numero ?? ""}?
          </DialogTitle>
          <DialogDescription className="text-center">
            Esta ação irá:
          </DialogDescription>
        </DialogHeader>

        <ul className="mx-auto max-w-sm space-y-1.5 text-sm text-muted-foreground">
          <li>• Estornar o estoque dos itens vendidos</li>
          <li>• Cancelar os lançamentos financeiros vinculados</li>
          <li>• Marcar a venda como cancelada</li>
          <li>• Registrar a operação em auditoria</li>
        </ul>

        {venda && (
          <div className="mx-auto rounded-md border border-border bg-muted/30 px-4 py-2 text-center">
            <p className="text-xs uppercase text-muted-foreground">
              Total da venda
            </p>
            <p className="font-mono text-lg font-bold tabular-nums">
              {formatBRL(venda.total)}
            </p>
          </div>
        )}

        <div>
          <Label htmlFor="motivo" className="mb-1.5 text-xs">
            Motivo do cancelamento (opcional)
          </Label>
          <Textarea
            id="motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={2}
            placeholder="Ex.: Cliente desistiu, erro de operação..."
            className="resize-none text-sm"
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={cancelar.isPending}
          >
            Voltar
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirmar}
            disabled={cancelar.isPending}
          >
            {cancelar.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <X className="h-4 w-4" />
            )}
            Confirmar cancelamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
