import { useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote,
  CreditCard,
  Smartphone,
  FileText,
  Clock,
  CheckCircle2,
  X,
  ArrowLeft,
  Loader2,
  Receipt,
  Wallet,
  ArrowRightLeft,
  type LucideIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/mock-data";
import {
  useFinalizarVendaPDV,
  type FormaPagamento,
  type StatusPagamento,
  type FinalizarVendaItem,
} from "@/hooks/useVendas";

interface FinalizarVendaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itens: FinalizarVendaItem[];
  subtotal: number;
  desconto: number;
  total: number;
  totalItens: number;
  cliente: { id: string; nome: string } | null;
  observacao: string;
  operadorEmail?: string | null;
  onConfirmed: (result: {
    vendaId: string;
    forma: FormaPagamento;
    status: StatusPagamento;
    troco: number;
  }) => void;
}

interface FormaPagamentoOption {
  key: FormaPagamento;
  label: string;
  icon: LucideIcon;
  defaultStatus: StatusPagamento;
  /** Forma que tipicamente fica pendente / gera contas a receber */
  pendentePorPadrao?: boolean;
}

const FORMAS: FormaPagamentoOption[] = [
  { key: "dinheiro", label: "Dinheiro", icon: Banknote, defaultStatus: "pago" },
  { key: "pix", label: "PIX", icon: Smartphone, defaultStatus: "pago" },
  { key: "cartao_debito", label: "Débito", icon: CreditCard, defaultStatus: "pago" },
  { key: "cartao_credito", label: "Crédito", icon: CreditCard, defaultStatus: "pago" },
  { key: "boleto", label: "Boleto", icon: FileText, defaultStatus: "pendente", pendentePorPadrao: true },
  { key: "outro", label: "Fiado / Pendente", icon: Clock, defaultStatus: "pendente", pendentePorPadrao: true },
];

const STATUS_COLORS: Record<StatusPagamento, string> = {
  pago: "bg-success/15 text-success border-success/30",
  pendente: "bg-warning/15 text-warning border-warning/30",
  parcial: "bg-primary/15 text-primary border-primary/30",
  cancelado: "bg-destructive/15 text-destructive border-destructive/30",
};

export function FinalizarVendaDialog({
  open,
  onOpenChange,
  itens,
  subtotal,
  desconto,
  total,
  totalItens,
  cliente,
  observacao,
  operadorEmail,
  onConfirmed,
}: FinalizarVendaDialogProps) {
  const [forma, setForma] = useState<FormaPagamento>("dinheiro");
  const [statusPagamento, setStatusPagamento] = useState<StatusPagamento>("pago");
  const [valorRecebidoStr, setValorRecebidoStr] = useState("");
  const [parcelas, setParcelas] = useState(1);
  const [obsFinal, setObsFinal] = useState("");
  const valorInputRef = useRef<HTMLInputElement>(null);

  const finalizar = useFinalizarVendaPDV();

  // Reset ao abrir
  useEffect(() => {
    if (open) {
      setForma("dinheiro");
      setStatusPagamento("pago");
      setValorRecebidoStr(total.toFixed(2));
      setParcelas(1);
      setObsFinal("");
      setTimeout(() => valorInputRef.current?.focus(), 50);
    }
  }, [open, total]);

  const formaSelecionada = useMemo(
    () => FORMAS.find((f) => f.key === forma) ?? FORMAS[0],
    [forma],
  );

  // Quando muda a forma, ajusta status default
  function selectForma(key: FormaPagamento) {
    setForma(key);
    const def = FORMAS.find((f) => f.key === key)?.defaultStatus ?? "pago";
    setStatusPagamento(def);
  }

  const valorRecebido = useMemo(() => {
    const n = Number(valorRecebidoStr.replace(",", "."));
    return isNaN(n) ? 0 : n;
  }, [valorRecebidoStr]);

  const troco = useMemo(() => {
    if (forma !== "dinheiro") return 0;
    return Math.max(0, valorRecebido - total);
  }, [forma, valorRecebido, total]);

  const valorFaltante = useMemo(() => {
    return Math.max(0, total - valorRecebido);
  }, [total, valorRecebido]);

  // Avisos por forma
  const dinheiroInsuficiente = forma === "dinheiro" && valorRecebido < total && statusPagamento === "pago";

  function handleConfirmar() {
    if (itens.length === 0) {
      return;
    }
    if (dinheiroInsuficiente) {
      return;
    }

    const isDinheiro = forma === "dinheiro";
    const valorRecebidoFinal = isDinheiro
      ? valorRecebido
      : statusPagamento === "parcial"
        ? valorRecebido
        : statusPagamento === "pago"
          ? total
          : 0;

    finalizar.mutate(
      {
        cliente_id: cliente?.id ?? null,
        subtotal,
        desconto,
        total,
        forma_pagamento: forma,
        status_pagamento: statusPagamento,
        valor_recebido: valorRecebidoFinal || null,
        troco: isDinheiro ? troco : null,
        observacao: [observacao, obsFinal].filter(Boolean).join(" — ") || null,
        itens,
      },
      {
        onSuccess: (vendaId) => {
          onConfirmed(vendaId);
        },
      },
    );
  }

  const podeParcial =
    forma !== "dinheiro" && valorRecebido > 0 && valorRecebido < total;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border bg-muted/30 px-6 py-4">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Receipt className="h-5 w-5 text-primary" /> Finalizar venda
          </DialogTitle>
          <DialogDescription>
            Confirme a forma de pagamento para concluir a operação no PDV.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-0 md:grid-cols-[1fr_320px]">
          {/* ============ Esquerda — pagamento ============ */}
          <div className="space-y-5 p-6">
            {/* Formas de pagamento */}
            <div>
              <Label className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Forma de pagamento
              </Label>
              <div className="grid grid-cols-3 gap-2">
                {FORMAS.map((f) => {
                  const Icon = f.icon;
                  const active = forma === f.key;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => selectForma(f.key)}
                      className={cn(
                        "flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 px-3 py-3 text-sm font-medium transition-all",
                        active
                          ? "border-primary bg-primary/10 text-primary shadow-sm"
                          : "border-border bg-card hover:border-primary/40 hover:bg-muted/40",
                      )}
                    >
                      <Icon className="h-5 w-5" />
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Status */}
            <div>
              <Label className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Status do pagamento
              </Label>
              <div className="flex flex-wrap gap-2">
                {(["pago", "pendente", "parcial"] as StatusPagamento[]).map((s) => {
                  const disabled = s === "parcial" && !podeParcial && forma !== "dinheiro";
                  return (
                    <button
                      key={s}
                      type="button"
                      disabled={disabled}
                      onClick={() => setStatusPagamento(s)}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-sm font-medium capitalize transition-colors",
                        statusPagamento === s
                          ? STATUS_COLORS[s]
                          : "border-border bg-card text-muted-foreground hover:bg-muted/40",
                        disabled && "cursor-not-allowed opacity-40",
                      )}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Valor recebido / troco */}
            {(forma === "dinheiro" || statusPagamento === "parcial") && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="valor-recebido" className="mb-1.5 block text-xs">
                    Valor recebido
                  </Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      R$
                    </span>
                    <Input
                      id="valor-recebido"
                      ref={valorInputRef}
                      value={valorRecebidoStr}
                      onChange={(e) => setValorRecebidoStr(e.target.value)}
                      type="number"
                      step="0.01"
                      min="0"
                      className="h-12 pl-9 font-mono text-lg tabular-nums"
                    />
                  </div>
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs">
                    {forma === "dinheiro" ? "Troco" : "Restante"}
                  </Label>
                  <div
                    className={cn(
                      "flex h-12 items-center rounded-md border px-3 font-mono text-lg font-semibold tabular-nums",
                      forma === "dinheiro"
                        ? troco > 0
                          ? "border-success/40 bg-success/10 text-success"
                          : "border-border bg-muted/30 text-muted-foreground"
                        : valorFaltante > 0
                          ? "border-warning/40 bg-warning/10 text-warning"
                          : "border-border bg-muted/30 text-muted-foreground",
                    )}
                  >
                    {formatBRL(forma === "dinheiro" ? troco : valorFaltante)}
                  </div>
                </div>
              </div>
            )}

            {/* Atalhos de cédula para dinheiro */}
            {forma === "dinheiro" && (
              <div className="flex flex-wrap gap-1.5">
                {[total, 50, 100, 200, 500].map((v, i) => (
                  <Button
                    key={i}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setValorRecebidoStr(v.toFixed(2))}
                  >
                    {i === 0 ? "Exato" : `R$ ${v}`}
                  </Button>
                ))}
              </div>
            )}

            {/* Parcelas para crédito */}
            {forma === "cartao_credito" && (
              <div>
                <Label className="mb-1.5 block text-xs">Parcelas</Label>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 6, 12].map((p) => (
                    <Button
                      key={p}
                      type="button"
                      variant={parcelas === p ? "default" : "outline"}
                      size="sm"
                      className="h-9 w-12"
                      onClick={() => setParcelas(p)}
                    >
                      {p}x
                    </Button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {parcelas}x de{" "}
                  <span className="font-medium tabular-nums text-foreground">
                    {formatBRL(total / parcelas)}
                  </span>
                </p>
              </div>
            )}

            {/* Observação */}
            <div>
              <Label htmlFor="obs-final" className="mb-1.5 block text-xs">
                Observação da finalização
              </Label>
              <Textarea
                id="obs-final"
                value={obsFinal}
                onChange={(e) => setObsFinal(e.target.value)}
                rows={2}
                className="resize-none text-sm"
                placeholder="Ex.: pagamento conferido, NF emitida…"
              />
            </div>
          </div>

          {/* ============ Direita — resumo ============ */}
          <aside className="border-t border-border bg-muted/20 p-6 md:border-l md:border-t-0">
            <div className="space-y-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Resumo
                </p>
                <div className="mt-2 space-y-1.5 text-sm">
                  <SummaryRow label="Itens">
                    {itens.length}{" "}
                    <span className="text-muted-foreground">
                      ({totalItens.toFixed(0)} un.)
                    </span>
                  </SummaryRow>
                  <SummaryRow label="Subtotal">{formatBRL(subtotal)}</SummaryRow>
                  <SummaryRow label="Descontos">
                    <span className="text-warning">
                      {desconto > 0 ? `- ${formatBRL(desconto)}` : formatBRL(0)}
                    </span>
                  </SummaryRow>
                </div>
              </div>

              <div className="border-t border-border pt-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Total a pagar
                </p>
                <p className="font-mono text-3xl font-bold tabular-nums text-primary">
                  {formatBRL(total)}
                </p>
              </div>

              {forma === "dinheiro" && troco > 0 && statusPagamento === "pago" && (
                <div className="rounded-lg border-2 border-success/40 bg-success/10 p-3 text-success">
                  <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide">
                    <ArrowRightLeft className="h-3.5 w-3.5" /> Troco para o cliente
                  </p>
                  <p className="font-mono text-2xl font-bold tabular-nums">
                    {formatBRL(troco)}
                  </p>
                </div>
              )}

              <div className="space-y-1 border-t border-border pt-4 text-xs text-muted-foreground">
                <p className="flex items-center gap-1.5">
                  <Wallet className="h-3.5 w-3.5" />
                  <span>
                    {formaSelecionada.label} ·{" "}
                    <Badge
                      variant="outline"
                      className={cn("capitalize", STATUS_COLORS[statusPagamento])}
                    >
                      {statusPagamento}
                    </Badge>
                  </span>
                </p>
                {cliente && <p>Cliente: <span className="text-foreground">{cliente.nome}</span></p>}
                {!cliente && <p>Cliente: Consumidor</p>}
                {operadorEmail && <p>Operador: <span className="text-foreground">{operadorEmail}</span></p>}
                <p>Data: <span className="text-foreground">{new Date().toLocaleString("pt-BR")}</span></p>
              </div>
            </div>
          </aside>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/20 px-6 py-4">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={finalizar.isPending}
          >
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={finalizar.isPending}
              className="text-destructive hover:text-destructive"
            >
              <X className="h-4 w-4" /> Cancelar
            </Button>
            <Button
              size="lg"
              className="h-11 min-w-[200px]"
              onClick={handleConfirmar}
              disabled={
                finalizar.isPending ||
                itens.length === 0 ||
                dinheiroInsuficiente
              }
            >
              {finalizar.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Confirmar venda
            </Button>
          </div>
        </div>

        {dinheiroInsuficiente && (
          <div className="border-t border-destructive/30 bg-destructive/10 px-6 py-2 text-center text-xs font-medium text-destructive">
            Valor recebido é menor que o total. Ajuste o valor ou marque o pagamento como parcial/pendente.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{children}</span>
    </div>
  );
}
