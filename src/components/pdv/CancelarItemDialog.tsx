import { useEffect, useMemo, useRef, useState } from "react";
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
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/mock-data";
import { Ban, XCircle } from "lucide-react";
import { useHotkeys } from "@/hooks/useHotkeys";

export interface CancelarItemDialogItem {
  key: string;
  nome: string;
  sku: string;
  unidade: string;
  quantidade: number;
  preco_unitario: number;
  desconto: number;
  cancelado?: boolean;
  vendido_por_peso?: boolean;
  casas_decimais?: number;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  itens: CancelarItemDialogItem[];
  onConfirm: (key: string) => void;
}

/**
 * Modal de cancelamento de item do carrinho (PDV).
 *
 * Regras:
 *  - Lista todos os itens (ativos e já cancelados).
 *  - Setas ↑/↓ navegam; Enter confirma; Esc fecha; mouse seleciona.
 *  - Itens já cancelados NÃO podem ser cancelados novamente.
 *  - O cancelamento marca o item como `cancelado` (não remove a linha).
 */
export function CancelarItemDialog({ open, onOpenChange, itens, onConfirm }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Sempre que abrir, seleciona o primeiro item ATIVO.
  useEffect(() => {
    if (!open) return;
    const firstAtivo = itens.findIndex((it) => !it.cancelado);
    setSelectedIdx(firstAtivo >= 0 ? firstAtivo : 0);
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug("[PDV_CANCEL_ITEM] modal aberto", { totalItens: itens.length });
    }
  }, [open, itens]);

  const itensComIndex = useMemo(
    () => itens.map((it, idx) => ({ ...it, idx })),
    [itens],
  );

  function move(delta: number) {
    if (itens.length === 0) return;
    let next = selectedIdx;
    for (let i = 0; i < itens.length; i++) {
      next = (next + delta + itens.length) % itens.length;
      // Permite navegar livremente; o destaque vai mesmo para cancelados,
      // mas confirmar não terá efeito sobre eles.
      break;
    }
    setSelectedIdx(next);
    if (import.meta.env.DEV) {
      const it = itens[next];
      if (it) {
        // eslint-disable-next-line no-console
        console.debug("[PDV_CANCEL_ITEM] item selecionado", {
          key: it.key,
          nome: it.nome,
        });
      }
    }
  }

  function handleConfirm(idx: number = selectedIdx) {
    const it = itens[idx];
    if (!it) return;
    if (it.cancelado) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.debug("[PDV_CANCEL_ITEM] tentativa duplicada ignorada", {
          key: it.key,
        });
      }
      return;
    }
    onConfirm(it.key);
  }

  useHotkeys(
    [
      {
        key: "ArrowDown",
        allowInInputs: true,
        handler: () => move(1),
      },
      {
        key: "ArrowUp",
        allowInInputs: true,
        handler: () => move(-1),
      },
      {
        key: "Enter",
        allowInInputs: true,
        handler: () => handleConfirm(),
      },
    ],
    { enabled: open, scope: "modal" },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="h-5 w-5 text-destructive" />
            Cancelar item da venda
          </DialogTitle>
          <DialogDescription>
            Use <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">↑</kbd>{" "}
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">↓</kbd>{" "}
            para navegar,{" "}
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">Enter</kbd>{" "}
            para cancelar o item selecionado e{" "}
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">Esc</kbd>{" "}
            para fechar.
          </DialogDescription>
        </DialogHeader>

        <div
          ref={listRef}
          className="max-h-[55vh] overflow-y-auto rounded-md border border-border"
        >
          {itensComIndex.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Nenhum item na venda atual.
            </p>
          ) : (
            <ul>
              {itensComIndex.map((it) => {
                const subtotal = Math.max(0, it.preco_unitario * it.quantidade - it.desconto);
                const isSelected = it.idx === selectedIdx;
                const qtdStr = it.vendido_por_peso
                  ? `${it.quantidade.toFixed(it.casas_decimais ?? 3)} ${it.unidade || "KG"}`
                  : `${it.quantidade} ${it.unidade || "un."}`;
                return (
                  <li
                    key={it.key}
                    onClick={() => setSelectedIdx(it.idx)}
                    onDoubleClick={() => handleConfirm(it.idx)}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 border-b border-border/60 px-4 py-3 transition-colors last:border-b-0",
                      isSelected && "bg-primary/10",
                      it.cancelado && "opacity-60",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "truncate font-medium",
                          it.cancelado && "line-through",
                        )}
                      >
                        {it.nome}
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {it.sku} · {qtdStr} × {formatBRL(it.preco_unitario)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm font-semibold tabular-nums">
                        {formatBRL(subtotal)}
                      </p>
                      {it.cancelado ? (
                        <Badge variant="destructive" className="mt-1">
                          Cancelado
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="mt-1">
                          Ativo
                        </Badge>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar (Esc)
          </Button>
          <Button
            variant="destructive"
            onClick={() => handleConfirm()}
            disabled={
              itens.length === 0 ||
              !itens[selectedIdx] ||
              !!itens[selectedIdx]?.cancelado
            }
          >
            <XCircle className="mr-2 h-4 w-4" />
            Cancelar item (Enter)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
