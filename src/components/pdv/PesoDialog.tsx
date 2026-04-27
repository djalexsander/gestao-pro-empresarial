import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Scale } from "lucide-react";

interface PesoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  produtoNome: string;
  precoPorKg: number;
  /** Casas decimais a manter ao confirmar. Default: 3 */
  casasDecimais?: number;
  onConfirm: (pesoKg: number) => void;
}

/**
 * Diálogo solicitando o peso (KG) ao operador quando um produto vendido por
 * peso é bipado pelo PLU/SKU sem etiqueta da balança.
 */
export function PesoDialog({
  open,
  onOpenChange,
  produtoNome,
  precoPorKg,
  casasDecimais = 3,
  onConfirm,
}: PesoDialogProps) {
  const [peso, setPeso] = useState<string>("");

  useEffect(() => {
    if (open) setPeso("");
  }, [open]);

  const pesoNum = Number(peso.replace(",", "."));
  const valido = !Number.isNaN(pesoNum) && pesoNum > 0;
  const total = valido ? pesoNum * precoPorKg : 0;

  function handleConfirm() {
    if (!valido) return;
    const factor = Math.pow(10, casasDecimais);
    onConfirm(Math.round(pesoNum * factor) / factor);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5" />
            Informar peso
          </DialogTitle>
          <DialogDescription>{produtoNome}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="peso-kg">Peso (KG)</Label>
            <Input
              id="peso-kg"
              autoFocus
              inputMode="decimal"
              value={peso}
              onChange={(e) => setPeso(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConfirm();
              }}
              placeholder="Ex.: 0,600"
              className="text-lg font-mono"
            />
          </div>
          <div className="rounded-md bg-muted/40 p-3 text-sm">
            <p className="text-muted-foreground">
              R$ {precoPorKg.toFixed(2)} / KG
            </p>
            <p className="text-xl font-semibold">
              Total: R$ {total.toFixed(2)}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={!valido}>
            Adicionar à venda
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
