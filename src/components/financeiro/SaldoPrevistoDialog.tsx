import { useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { formatBRL } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import type { LancamentoDetalhe } from "@/components/financeiro/LancamentoDetalheDialog";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lancamentos: LancamentoDetalhe[];
  periodoInicio: string; // YYYY-MM-DD
  periodoFim: string; // YYYY-MM-DD
}

function aberto(l: LancamentoDetalhe): number {
  if (l.status === "cancelado") return 0;
  if (l.status === "pago" || l.status === "recebido") return 0;
  const r = (Number(l.valor) || 0) - (Number(l.valor_pago) || 0);
  return r > 0 ? r : 0;
}

function isVencido(l: LancamentoDetalhe): boolean {
  if (!l.data_vencimento) return false;
  if (l.status === "pago" || l.status === "recebido" || l.status === "cancelado") return false;
  return new Date(l.data_vencimento) < new Date(new Date().toDateString());
}

function dentro(d: string | null | undefined, ini: string, fim: string): boolean {
  if (!d) return false;
  const s = d.slice(0, 10);
  return s >= ini && s <= fim;
}

export function SaldoPrevistoDialog({
  open,
  onOpenChange,
  lancamentos,
  periodoInicio,
  periodoFim,
}: Props) {
  const m = useMemo(() => {
    const receber = lancamentos.filter((l) => l.tipo === "receber");
    const pagar = lancamentos.filter((l) => l.tipo === "pagar");

    const aReceberFuturo = receber
      .filter((l) => !isVencido(l))
      .reduce((s, l) => s + aberto(l), 0);
    const aPagarFuturo = pagar
      .filter((l) => !isVencido(l))
      .reduce((s, l) => s + aberto(l), 0);

    const recebimentosVencidos = receber.filter(isVencido).reduce((s, l) => s + aberto(l), 0);
    const pagamentosVencidos = pagar.filter(isVencido).reduce((s, l) => s + aberto(l), 0);

    const recebidoPeriodo = receber
      .filter(
        (l) =>
          (l.status === "recebido" || l.status === "pago" || l.status === "parcial") &&
          dentro(l.data_pagamento, periodoInicio, periodoFim),
      )
      .reduce((s, l) => s + (Number(l.valor_pago) || 0), 0);

    const pagoPeriodo = pagar
      .filter(
        (l) =>
          (l.status === "pago" || l.status === "parcial") &&
          dentro(l.data_pagamento, periodoInicio, periodoFim),
      )
      .reduce((s, l) => s + (Number(l.valor_pago) || 0), 0);

    return {
      aReceberFuturo,
      aPagarFuturo,
      saldoPrevisto: aReceberFuturo - aPagarFuturo,
      recebidoPeriodo,
      pagoPeriodo,
      resultadoRealizado: recebidoPeriodo - pagoPeriodo,
      recebimentosVencidos,
      pagamentosVencidos,
      saldoVencido: recebimentosVencidos - pagamentosVencidos,
    };
  }, [lancamentos, periodoInicio, periodoFim]);

  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined" || !import.meta.env.DEV) return;
    // eslint-disable-next-line no-console
    console.log("[POSICAO_FINANCEIRA]", {
      saldo_previsto: m.saldoPrevisto,
      a_receber_futuro: m.aReceberFuturo,
      a_pagar_futuro: m.aPagarFuturo,
      recebido_periodo: m.recebidoPeriodo,
      pago_periodo: m.pagoPeriodo,
      vencidos_receber: m.recebimentosVencidos,
      vencidos_pagar: m.pagamentosVencidos,
      periodo: { inicio: periodoInicio, fim: periodoFim },
    });
  }, [open, m, periodoInicio, periodoFim]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[95vw] max-w-3xl flex-col gap-0 p-0 sm:w-full">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>Saldo previsto</DialogTitle>
          <DialogDescription>
            Composição financeira separada por previsão, realizado e vencidos.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-4">
          <Bloco titulo="Previsão (em aberto)">
            <Linha label="A receber futuro" valor={m.aReceberFuturo} tone="success" />
            <Linha label="A pagar futuro" valor={-m.aPagarFuturo} tone="danger" />
            <Separator className="my-2" />
            <Linha
              label="Saldo previsto"
              valor={m.saldoPrevisto}
              tone={m.saldoPrevisto >= 0 ? "success" : "danger"}
              destaque
            />
          </Bloco>

          <Bloco titulo="Realizado no período">
            <Linha label="Recebido no período" valor={m.recebidoPeriodo} tone="success" />
            <Linha label="Pago no período" valor={-m.pagoPeriodo} tone="danger" />
            <Separator className="my-2" />
            <Linha
              label="Resultado realizado"
              valor={m.resultadoRealizado}
              tone={m.resultadoRealizado >= 0 ? "success" : "danger"}
              destaque
            />
          </Bloco>

          <Bloco titulo="Vencidos">
            <Linha
              label="Recebimentos vencidos"
              valor={m.recebimentosVencidos}
              tone={m.recebimentosVencidos > 0 ? "danger" : "muted"}
            />
            <Linha
              label="Pagamentos vencidos"
              valor={-m.pagamentosVencidos}
              tone={m.pagamentosVencidos > 0 ? "danger" : "muted"}
            />
            <Separator className="my-2" />
            <Linha
              label="Saldo vencido líquido"
              valor={m.saldoVencido}
              tone={m.saldoVencido >= 0 ? "success" : "danger"}
              destaque
            />
          </Bloco>
        </div>

        <DialogFooter className="border-t border-border px-6 py-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card/30 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {titulo}
      </p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Linha({
  label,
  valor,
  tone,
  destaque,
}: {
  label: string;
  valor: number;
  tone: "success" | "danger" | "muted";
  destaque?: boolean;
}) {
  const toneClass = {
    success: "text-success",
    danger: "text-destructive",
    muted: "text-muted-foreground",
  }[tone];
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 text-sm",
        destaque && "pt-1 text-base font-semibold",
      )}
    >
      <span className={cn(destaque ? "text-foreground" : "text-muted-foreground")}>{label}</span>
      <span className={cn("font-mono tabular-nums", toneClass)}>{formatBRL(valor)}</span>
    </div>
  );
}
