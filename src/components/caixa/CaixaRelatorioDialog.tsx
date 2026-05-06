import { useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Printer, Wallet, Power, PowerOff } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { dataClient } from "@/integrations/data";
import { formatBRL } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import type { Caixa, CaixaMovimento } from "@/hooks/useCaixa";
import { downloadCanvasAsPng } from "@/lib/export-png-canvas";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  caixaId: string | null;
}

function fmt(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const MOV_LABEL: Record<string, string> = {
  abertura: "Abertura",
  venda: "Venda",
  sangria: "Sangria",
  suprimento: "Suprimento",
  fechamento: "Fechamento",
};

export function CaixaRelatorioDialog({ open, onOpenChange, caixaId }: Props) {
  const printRef = useRef<HTMLDivElement | null>(null);

  const { data: caixa, isLoading: loadingCaixa } = useQuery({
    queryKey: ["caixa", "detalhe", caixaId],
    enabled: !!caixaId && open,
    queryFn: async (): Promise<Caixa | null> => {
      if (!caixaId) return null;
      const { data, error } = await supabase
        .from("caixas")
        .select("*")
        .eq("id", caixaId)
        .maybeSingle();
      if (error) throw error;
      return (data as Caixa | null) ?? null;
    },
  });

  const { data: movimentos = [], isLoading: loadingMovs } = useQuery({
    queryKey: ["caixa", "movimentos", caixaId],
    enabled: !!caixaId && open,
    queryFn: async (): Promise<CaixaMovimento[]> => {
      if (!caixaId) return [];
      return (await dataClient.caixa.movimentos(caixaId)) as CaixaMovimento[];
    },
  });

  const totaisMov = useMemo(() => {
    let suprimentos = 0;
    let sangrias = 0;
    let vendas = 0;
    for (const m of movimentos) {
      const v = Number(m.valor) || 0;
      if (m.tipo === "suprimento") suprimentos += v;
      else if (m.tipo === "sangria") sangrias += v;
      else if (m.tipo === "venda") vendas += v;
    }
    return { suprimentos, sangrias, vendas };
  }, [movimentos]);

  const isLoading = loadingCaixa || loadingMovs;

  async function handleExportPng() {
    if (!printRef.current) return;
    await downloadCanvasAsPng(printRef.current, {
      filename: `relatorio-caixa-${caixaId?.slice(0, 8)}.png`,
      backgroundColor: "#0b1220",
    });
  }

  function handlePrint() {
    if (!printRef.current) return;
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) return;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Relatório de caixa</title>
      <style>
        body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding: 24px; color: #0f172a; }
        h1,h2,h3 { margin: 0 0 8px; }
        table { width:100%; border-collapse: collapse; margin-top:8px; }
        th, td { text-align:left; padding:6px 8px; border-bottom:1px solid #e2e8f0; font-size:12px; }
        th { background:#f1f5f9; }
        .grid { display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap:8px 24px; margin:12px 0; font-size:13px; }
        .num { font-variant-numeric: tabular-nums; text-align:right; }
        .muted { color:#64748b; font-size:12px; }
      </style></head><body>${printRef.current.innerHTML}</body></html>`;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => {
      win.print();
      win.close();
    }, 300);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" />
            Relatório de caixa
          </DialogTitle>
          <DialogDescription>
            Visão consolidada do turno: abertura, movimentações e fechamento.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !caixa ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="max-h-[70vh] overflow-y-auto pr-1">
            <div ref={printRef} className="space-y-4 rounded-md border border-border bg-card p-4">
              {/* Cabeçalho */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-foreground">Resumo do turno</h2>
                  <p className="muted text-xs text-muted-foreground">
                    Caixa #{caixa.id.slice(0, 8)}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    caixa.status === "aberto"
                      ? "border-success/40 bg-success/15 text-success"
                      : "border-border bg-muted text-muted-foreground",
                  )}
                >
                  {caixa.status}
                </Badge>
              </div>

              <div className="grid grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <Linha label="Aberto em" value={fmt(caixa.data_abertura)} icon={Power} />
                <Linha label="Fechado em" value={fmt(caixa.data_fechamento)} icon={PowerOff} />
                <Linha label="Valor inicial" value={formatBRL(caixa.valor_inicial)} />
                <Linha label="Vendas no turno" value={String(caixa.qtd_vendas ?? 0)} />
              </div>

              {/* Por forma de pagamento */}
              <div>
                <h3 className="mb-2 text-sm font-semibold text-foreground">
                  Recebido por forma de pagamento
                </h3>
                <Table>
                  <TableBody>
                    <FormaTR label="Dinheiro" value={caixa.total_dinheiro} />
                    <FormaTR label="PIX" value={caixa.total_pix} />
                    <FormaTR label="Débito" value={caixa.total_debito} />
                    <FormaTR label="Crédito" value={caixa.total_credito} />
                    <FormaTR label="Boleto" value={caixa.total_boleto} />
                    <FormaTR label="iFood" value={caixa.total_ifood} />
                    <FormaTR label="Fiado" value={caixa.total_fiado} />
                    {caixa.total_outros > 0 && (
                      <FormaTR label="Outros" value={caixa.total_outros} />
                    )}
                    <TableRow>
                      <TableCell className="font-semibold">Total vendido</TableCell>
                      <TableCell className="num text-right font-mono font-semibold tabular-nums">
                        {formatBRL(caixa.total_vendas)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              {/* Conferência */}
              <div>
                <h3 className="mb-2 text-sm font-semibold text-foreground">Conferência</h3>
                <Table>
                  <TableBody>
                    <FormaTR label="Suprimentos" value={totaisMov.suprimentos} />
                    <FormaTR label="Sangrias" value={totaisMov.sangrias} />
                    <FormaTR label="Esperado em dinheiro" value={caixa.valor_esperado ?? 0} />
                    <FormaTR label="Informado no fechamento" value={caixa.valor_informado ?? 0} />
                    <TableRow>
                      <TableCell className="font-semibold">Diferença</TableCell>
                      <TableCell
                        className={cn(
                          "num text-right font-mono font-semibold tabular-nums",
                          caixa.diferenca === null
                            ? "text-muted-foreground"
                            : Math.abs(caixa.diferenca) < 0.009
                              ? "text-success"
                              : "text-destructive",
                        )}
                      >
                        {caixa.diferenca === null
                          ? "—"
                          : (caixa.diferenca > 0 ? "+" : "") + formatBRL(caixa.diferenca)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              {/* Observações */}
              {(caixa.observacao || caixa.observacao_fechamento) && (
                <div className="space-y-2 rounded-md border border-border/60 bg-muted/30 p-3 text-xs">
                  {caixa.observacao && (
                    <p>
                      <strong>Abertura:</strong> {caixa.observacao}
                    </p>
                  )}
                  {caixa.observacao_fechamento && (
                    <p>
                      <strong>Fechamento:</strong> {caixa.observacao_fechamento}
                    </p>
                  )}
                </div>
              )}

              {/* Movimentos */}
              <div>
                <h3 className="mb-2 text-sm font-semibold text-foreground">
                  Movimentos do turno ({movimentos.length})
                </h3>
                {movimentos.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhum movimento.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Quando</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Motivo</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...movimentos].reverse().map((m) => (
                        <TableRow key={m.id}>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {fmt(m.created_at)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {MOV_LABEL[m.tipo] ?? m.tipo}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {m.motivo ?? "—"}
                          </TableCell>
                          <TableCell className="num text-right font-mono text-xs tabular-nums">
                            {formatBRL(Number(m.valor) || 0)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={handleExportPng} disabled={!caixa}>
            <Download className="h-4 w-4" /> PNG
          </Button>
          <Button variant="outline" onClick={handlePrint} disabled={!caixa}>
            <Printer className="h-4 w-4" /> Imprimir
          </Button>
          <Button onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Linha({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon?: typeof Wallet;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        {label}
      </span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

function FormaTR({ label, value }: { label: string; value: number }) {
  return (
    <TableRow>
      <TableCell className="text-sm">{label}</TableCell>
      <TableCell className="num text-right font-mono text-sm tabular-nums">
        {formatBRL(Number(value) || 0)}
      </TableCell>
    </TableRow>
  );
}
