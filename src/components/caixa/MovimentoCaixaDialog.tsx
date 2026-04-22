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
import { ArrowDownToLine, ArrowUpFromLine, Loader2 } from "lucide-react";
import { useRegistrarMovimentoCaixa } from "@/hooks/useCaixa";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caixaId: string;
  tipo: "sangria" | "suprimento";
}

const META = {
  sangria: {
    title: "Sangria de caixa",
    description: "Retirar dinheiro do caixa (ex.: enviar ao cofre, pagamento avulso).",
    icon: ArrowUpFromLine,
    tone: "text-destructive bg-destructive/10",
    button: "Confirmar sangria",
    placeholder: "Ex.: envio ao cofre, pagamento de despesa",
  },
  suprimento: {
    title: "Suprimento de caixa",
    description: "Adicionar dinheiro ao caixa (reforço de troco).",
    icon: ArrowDownToLine,
    tone: "text-success bg-success/15",
    button: "Confirmar suprimento",
    placeholder: "Ex.: reforço de troco em notas pequenas",
  },
} as const;

export function MovimentoCaixaDialog({ open, onOpenChange, caixaId, tipo }: Props) {
  const meta = META[tipo];
  const Icon = meta.icon;

  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const registrar = useRegistrarMovimentoCaixa();

  useEffect(() => {
    if (open) {
      setValor("");
      setMotivo("");
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = Number(valor.replace(",", "."));
    if (Number.isNaN(v) || v <= 0) return;
    await registrar.mutateAsync({
      caixa_id: caixaId,
      tipo,
      valor: v,
      motivo: motivo.trim() || null,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className={cn("mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full", meta.tone)}>
            <Icon className="h-6 w-6" />
          </div>
          <DialogTitle className="text-center">{meta.title}</DialogTitle>
          <DialogDescription className="text-center">{meta.description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mov-valor">Valor</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                R$
              </span>
              <Input
                id="mov-valor"
                type="text"
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                className="pl-10 font-mono text-lg tabular-nums"
                autoFocus
                placeholder="0,00"
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mov-motivo">Motivo</Label>
            <Textarea
              id="mov-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={meta.placeholder}
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={registrar.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={registrar.isPending}>
              {registrar.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Registrando...</>
              ) : (
                meta.button
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
