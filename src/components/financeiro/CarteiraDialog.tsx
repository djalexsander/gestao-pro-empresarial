import { useEffect, useMemo, useState } from "react";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import type { LancamentoDetalhe } from "@/components/financeiro/LancamentoDetalheDialog";

type Tipo = "receber" | "pagar";
type TabKey = "aberto" | "realizados" | "cancelados";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tipo: Tipo;
  lancamentos: LancamentoDetalhe[];
  onSelect?: (l: LancamentoDetalhe) => void;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const s = d.length >= 10 ? d.slice(0, 10) : d;
  const [y, m, day] = s.split("-");
  if (!y || !m || !day) return d;
  return `${day}/${m}/${y}`;
}

function isVencido(l: LancamentoDetalhe): boolean {
  if (!l.data_vencimento) return false;
  if (l.status === "pago" || l.status === "recebido" || l.status === "cancelado") return false;
  return new Date(l.data_vencimento) < new Date(new Date().toDateString());
}

function origemLabel(l: LancamentoDetalhe): string {
  if (l.venda_id || l.venda_numero) return "Venda/PDV";
  if (l.compra_id || l.compra_numero) return "Compra";
  return "Manual";
}

function statusBadge(l: LancamentoDetalhe) {
  if (l.status === "pago" || l.status === "recebido") {
    return (
      <Badge className="border-success/30 bg-success/15 text-success hover:bg-success/15">
        Pago
      </Badge>
    );
  }
  if (l.status === "cancelado") {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Cancelado
      </Badge>
    );
  }
  if (l.status === "parcial") {
    return (
      <Badge className="border-info/30 bg-info/15 text-info hover:bg-info/15">Parcial</Badge>
    );
  }
  if (isVencido(l)) {
    return (
      <Badge className="border-destructive/30 bg-destructive/15 text-destructive hover:bg-destructive/15">
        Vencido
      </Badge>
    );
  }
  return (
    <Badge className="border-warning/30 bg-warning/15 text-warning-foreground hover:bg-warning/15">
      Pendente
    </Badge>
  );
}

export function CarteiraDialog({ open, onOpenChange, tipo, lancamentos, onSelect }: Props) {
  const [tab, setTab] = useState<TabKey>("aberto");

  // Sempre começar em "aberto" ao reabrir.
  useEffect(() => {
    if (open) setTab("aberto");
  }, [open]);

  const baseTipo = useMemo(
    () => lancamentos.filter((l) => l.tipo === tipo),
    [lancamentos, tipo],
  );

  const aberto = useMemo(() => {
    return baseTipo.filter((l) => {
      if (l.status === "cancelado") return false;
      if (l.status === "pago" || l.status === "recebido") return false;
      const restante = (Number(l.valor) || 0) - (Number(l.valor_pago) || 0);
      return restante > 0.005;
    });
  }, [baseTipo]);

  const realizados = useMemo(
    () =>
      baseTipo.filter(
        (l) =>
          l.status === "pago" ||
          l.status === "recebido" ||
          (l.status === "parcial" &&
            (Number(l.valor) || 0) - (Number(l.valor_pago) || 0) <= 0.005),
      ),
    [baseTipo],
  );

  const cancelados = useMemo(
    () => baseTipo.filter((l) => l.status === "cancelado"),
    [baseTipo],
  );

  const totalAberto = aberto.reduce(
    (s, l) => s + ((Number(l.valor) || 0) - (Number(l.valor_pago) || 0)),
    0,
  );
  const totalPago = realizados.reduce((s, l) => s + (Number(l.valor_pago) || 0), 0);
  const totalParcial = aberto
    .filter((l) => Number(l.valor_pago ?? 0) > 0)
    .reduce((s, l) => s + ((Number(l.valor) || 0) - (Number(l.valor_pago) || 0)), 0);
  const totalVencido = aberto
    .filter(isVencido)
    .reduce((s, l) => s + ((Number(l.valor) || 0) - (Number(l.valor_pago) || 0)), 0);
  const totalCancelado = cancelados.reduce((s, l) => s + (Number(l.valor) || 0), 0);

  // DEV log
  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined" || !import.meta.env.DEV) return;
    const tag = tipo === "receber" ? "[CARTEIRA_RECEBER]" : "[CARTEIRA_PAGAR]";
    // eslint-disable-next-line no-console
    console.log(tag, {
      total_aberto: totalAberto,
      total_pago: totalPago,
      total_parcial: totalParcial,
      total_vencido: totalVencido,
      total_cancelado: totalCancelado,
      qtd_abertos: aberto.length,
      qtd_recebidos: realizados.length,
      qtd_cancelados: cancelados.length,
    });
  }, [
    open,
    tipo,
    totalAberto,
    totalPago,
    totalParcial,
    totalVencido,
    totalCancelado,
    aberto.length,
    realizados.length,
    cancelados.length,
  ]);

  const titulo = tipo === "receber" ? "Total a receber" : "Total a pagar";
  const subtitulo =
    tipo === "receber"
      ? "Carteira ativa de contas a receber"
      : "Carteira ativa de contas a pagar";
  const realizadosLabel = tipo === "receber" ? "Recebidos" : "Pagos";

  const rows =
    tab === "aberto" ? aberto : tab === "realizados" ? realizados : cancelados;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[95vw] max-w-5xl flex-col gap-0 p-0 sm:w-full">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{subtitulo}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-6 py-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Resumo label="Em aberto" valor={formatBRL(totalAberto)} tone="warning" />
            <Resumo
              label="Vencidos"
              valor={formatBRL(totalVencido)}
              tone={totalVencido > 0 ? "danger" : "muted"}
            />
            <Resumo label="Parciais (restante)" valor={formatBRL(totalParcial)} tone="info" />
            <Resumo
              label={realizadosLabel}
              valor={formatBRL(totalPago)}
              tone="success"
            />
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
            <TabsList>
              <TabsTrigger value="aberto">Em aberto ({aberto.length})</TabsTrigger>
              <TabsTrigger value="realizados">
                {realizadosLabel} ({realizados.length})
              </TabsTrigger>
              <TabsTrigger value="cancelados">
                Cancelados ({cancelados.length})
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-card/20 [scrollbar-color:hsl(var(--muted-foreground))_transparent] [scrollbar-width:thin]">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted/80 backdrop-blur supports-[backdrop-filter]:bg-muted/60">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="font-semibold text-foreground">Descrição</TableHead>
                  <TableHead className="font-semibold text-foreground">
                    {tipo === "receber" ? "Cliente" : "Fornecedor"}
                  </TableHead>
                  <TableHead className="font-semibold text-foreground">Origem</TableHead>
                  <TableHead className="font-semibold text-foreground">Vencimento</TableHead>
                  <TableHead className="text-right font-semibold text-foreground">
                    Valor
                  </TableHead>
                  <TableHead className="text-right font-semibold text-foreground">Pago</TableHead>
                  <TableHead className="text-right font-semibold text-foreground">
                    Restante
                  </TableHead>
                  <TableHead className="font-semibold text-foreground">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                      Nenhum título nesta aba.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((l) => {
                    const valor = Number(l.valor) || 0;
                    const pago = Number(l.valor_pago) || 0;
                    const restante = Math.max(0, valor - pago);
                    const venc = isVencido(l);
                    return (
                      <TableRow
                        key={l.id}
                        className={cn(
                          "cursor-pointer transition-colors hover:bg-primary/5",
                          venc && tab === "aberto" && "bg-destructive/5",
                        )}
                        onClick={() => onSelect?.(l)}
                      >
                        <TableCell className="py-2.5">{l.descricao}</TableCell>
                        <TableCell className="py-2.5 text-muted-foreground">
                          {(tipo === "receber" ? l.cliente_nome : l.fornecedor_nome) ?? "—"}
                        </TableCell>
                        <TableCell className="py-2.5">
                          <Badge variant="outline" className="font-normal">
                            {origemLabel(l)}
                          </Badge>
                        </TableCell>
                        <TableCell
                          className={cn(
                            "py-2.5",
                            venc && tab === "aberto" && "font-medium text-destructive",
                          )}
                        >
                          {fmtDate(l.data_vencimento)}
                        </TableCell>
                        <TableCell className="py-2.5 text-right font-mono tabular-nums">
                          {formatBRL(valor)}
                        </TableCell>
                        <TableCell className="py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                          {formatBRL(pago)}
                        </TableCell>
                        <TableCell className="py-2.5 text-right font-mono font-medium tabular-nums">
                          {formatBRL(restante)}
                        </TableCell>
                        <TableCell className="py-2.5">{statusBadge(l)}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
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

function Resumo({
  label,
  valor,
  tone,
}: {
  label: string;
  valor: string;
  tone: "success" | "danger" | "info" | "warning" | "muted";
}) {
  const toneClass: Record<typeof tone, string> = {
    success: "text-success",
    danger: "text-destructive",
    info: "text-info",
    warning: "text-warning-foreground",
    muted: "text-muted-foreground",
  };
  return (
    <div className="rounded-md border border-border bg-card/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-mono text-base font-semibold tabular-nums", toneClass[tone])}>
        {valor}
      </p>
    </div>
  );
}
