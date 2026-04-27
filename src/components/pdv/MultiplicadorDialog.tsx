import { useEffect, useRef, useState } from "react";
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
import { X as XIcon } from "lucide-react";

interface MultiplicadorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Recebe a quantidade inteira validada (>=1) para aplicar à próxima bipagem. */
  onConfirm: (quantidade: number) => void;
}

/**
 * Diálogo do atalho F5 — multiplicador de quantidade.
 *
 * Aceita formatos: "6", "6x", "x6". Ignora espaços. Apenas inteiros >= 1.
 * Confirma com Enter; Esc fecha.
 *
 * Foco: ao abrir, garantimos que o input recebe foco imediatamente
 * (mesmo após reabertura), via onOpenAutoFocus + ref + microtask, para
 * que o operador possa começar a digitar sem usar o mouse.
 */
export function MultiplicadorDialog({
  open,
  onOpenChange,
  onConfirm,
}: MultiplicadorDialogProps) {
  const [valor, setValor] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sempre que o modal abrir, limpa o campo e prepara para nova digitação.
  useEffect(() => {
    if (open) {
      setValor("");
      setErro(null);
    }
  }, [open]);

  // Reforço de foco: alguns navegadores/Radix podem perder o autoFocus em
  // reaberturas rápidas. Garantimos via rAF logo que o open vira true.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  function parseQuantidade(raw: string): number | null {
    const limpo = raw.trim().toLowerCase().replace(/\s+/g, "");
    if (!limpo) return null;
    const m = limpo.match(/^x?(\d+)x?$/);
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return null;
    return n;
  }

  function handleConfirm() {
    const q = parseQuantidade(valor);
    if (q === null) {
      setErro("Quantidade inválida. Use um inteiro >= 1, ex.: 6, 6x ou x6.");
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    onConfirm(q);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-sm"
        onOpenAutoFocus={(e) => {
          // Bloqueia o foco padrão do Radix (que vai para o primeiro
          // botão/foco) e move explicitamente para o input de quantidade.
          e.preventDefault();
          inputRef.current?.focus();
          inputRef.current?.select();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XIcon className="h-5 w-5" />
            Multiplicador de quantidade
          </DialogTitle>
          <DialogDescription>
            Digite a quantidade e pressione Enter — será aplicada ao próximo
            produto bipado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="mult-qtd">Quantidade</Label>
            <Input
              id="mult-qtd"
              ref={inputRef}
              autoFocus
              inputMode="numeric"
              value={valor}
              onChange={(e) => {
                setValor(e.target.value);
                setErro(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleConfirm();
                }
              }}
              placeholder="Ex.: 6, 6x ou x6"
              className="text-2xl font-mono ring-2 ring-primary/40 focus-visible:ring-primary"
            />
            {erro && <p className="text-xs text-destructive">{erro}</p>}
            <p className="text-xs text-muted-foreground">
              Após confirmar, bipe o produto. O multiplicador volta para 1×
              automaticamente.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm}>Aplicar multiplicador</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
