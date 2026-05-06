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
  Plus,
  Trash2,
  UtensilsCrossed,
  AlertTriangle,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
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
  type FinalizarVendaPagamento,
} from "@/hooks/useVendas";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useOperador } from "@/components/auth/OperadorProvider";
import { useTerminal } from "@/components/auth/TerminalProvider";

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
  /**
   * Chave de idempotência da venda (UUID). Estável durante toda a vida do
   * carrinho atual. Reenvio com o mesmo UUID NÃO duplica venda nem estoque.
   */
  clientUuid?: string | null;
  /**
   * Chamado quando o operador clica em "Selecionar / cadastrar cliente" no
   * fluxo de venda Fiado. O PDV deve abrir o popover/diálogo de cliente.
   * O modal de finalização permanece aberto.
   */
  onSelecionarCliente?: () => void;
  onConfirmed: (result: {
    vendaId: string;
    forma: FormaPagamento;
    status: StatusPagamento;
    troco: number;
    valorRecebido: number;
  }) => void;
}

interface FormaPagamentoOption {
  key: FormaPagamento;
  label: string;
  icon: LucideIcon;
  /** Atalho de teclado (F1, F2, ...) */
  shortcut: string;
  /** Se true, normalmente fica pendente (gera contas a receber) */
  pendentePorPadrao?: boolean;
  /** Permite calcular troco (apenas dinheiro) */
  permiteTroco?: boolean;
}

const FORMAS: FormaPagamentoOption[] = [
  { key: "dinheiro", label: "Dinheiro", icon: Banknote, shortcut: "F1", permiteTroco: true },
  { key: "pix", label: "PIX", icon: Smartphone, shortcut: "F2" },
  { key: "cartao_debito", label: "Débito", icon: CreditCard, shortcut: "F3" },
  { key: "cartao_credito", label: "Crédito", icon: CreditCard, shortcut: "F4" },
  { key: "boleto", label: "Boleto", icon: FileText, shortcut: "F5", pendentePorPadrao: true },
  { key: "fiado", label: "Fiado", icon: Clock, shortcut: "F6", pendentePorPadrao: true },
  { key: "ifood", label: "iFood", icon: UtensilsCrossed, shortcut: "F7", pendentePorPadrao: true },
];

const FORMA_BY_KEY: Record<FormaPagamento, FormaPagamentoOption> = FORMAS.reduce(
  (acc, f) => {
    acc[f.key] = f;
    return acc;
  },
  {} as Record<FormaPagamento, FormaPagamentoOption>,
);

// Para formas não listadas no PDV, fornece um fallback seguro
function getFormaInfo(key: FormaPagamento): FormaPagamentoOption {
  return FORMA_BY_KEY[key] ?? { key, label: key, icon: Wallet };
}

const STATUS_COLORS: Record<StatusPagamento, string> = {
  pago: "bg-success/15 text-success border-success/30",
  pendente: "bg-warning/15 text-warning border-warning/30",
  parcial: "bg-primary/15 text-primary border-primary/30",
  cancelado: "bg-destructive/15 text-destructive border-destructive/30",
};

interface PagamentoLinha {
  uid: string;
  forma: FormaPagamento;
  valor: number;
  valorRecebido: number; // só relevante para dinheiro
  parcelas: number; // só relevante para crédito
}

function novoPagamento(forma: FormaPagamento, valor: number): PagamentoLinha {
  return {
    uid: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    forma,
    valor: Math.max(0, Number(valor.toFixed(2))),
    valorRecebido: 0,
    parcelas: 1,
  };
}

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
  clientUuid,
  onSelecionarCliente,
  onConfirmed,
}: FinalizarVendaDialogProps) {
  const [pagamentos, setPagamentos] = useState<PagamentoLinha[]>([]);
  const [obsFinal, setObsFinal] = useState("");
  const [hotkeyFlash, setHotkeyFlash] = useState<string | null>(null);
  const [vencimentoFiado, setVencimentoFiado] = useState<string>("");
  const [descontoFinalStr, setDescontoFinalStr] = useState<string>("");
  const ultimoValorRef = useRef<HTMLInputElement>(null);
  const vencimentoInputRef = useRef<HTMLInputElement>(null);
  const descontoFinalRef = useRef<HTMLInputElement>(null);
  const dialogContentRef = useRef<HTMLDivElement>(null);

  const finalizar = useFinalizarVendaPDV();
  const { operador } = useOperador();
  const { terminal } = useTerminal();

  // Sugere vencimento padrão +30 dias da data atual.
  function dataPadraoFiado(): string {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  }

  // Reset ao abrir: começa com 1 pagamento em dinheiro cobrindo o total
  useEffect(() => {
    if (open) {
      const inicial = novoPagamento("dinheiro", total);
      inicial.valorRecebido = total;
      setPagamentos([inicial]);
      setObsFinal("");
      setHotkeyFlash(null);
      setVencimentoFiado(dataPadraoFiado());
      setDescontoFinalStr("");
      setTimeout(() => ultimoValorRef.current?.focus(), 50);
    }
  }, [open, total]);

  // ============= Desconto adicional aplicado no fechamento =============
  const descontoFinal = useMemo(() => {
    const v = Number(descontoFinalStr.replace(",", "."));
    if (!Number.isFinite(v) || v < 0) return 0;
    return Number(v.toFixed(2));
  }, [descontoFinalStr]);

  const descontoExcedeTotal = descontoFinal > total + 0.005;
  const descontoTotalEfetivo = desconto + Math.min(descontoFinal, total);
  const totalEfetivo = useMemo(
    () => Math.max(0, Number((total - Math.min(descontoFinal, total)).toFixed(2))),
    [total, descontoFinal],
  );

  // Quando o desconto final muda, sincroniza o pagamento se houver apenas
  // um único pagamento e ele ainda casa com o total anterior (UX comum no PDV).
  useEffect(() => {
    if (!open) return;
    setPagamentos((prev) => {
      if (prev.length !== 1) return prev;
      const p = prev[0];
      const next = { ...p, valor: totalEfetivo };
      if (p.forma === "dinheiro") next.valorRecebido = totalEfetivo;
      return [next];
    });
  }, [totalEfetivo, open]);

  // Feedback visual de atalho (300ms)
  function flashHotkey(key: string) {
    setHotkeyFlash(key);
    window.setTimeout(() => {
      setHotkeyFlash((cur) => (cur === key ? null : cur));
    }, 350);
  }

  // ============= Cálculos derivados =============
  const totalPago = useMemo(
    () => pagamentos.reduce((acc, p) => acc + (Number(p.valor) || 0), 0),
    [pagamentos],
  );

  const totalRecebidoDinheiro = useMemo(
    () =>
      pagamentos
        .filter((p) => p.forma === "dinheiro")
        .reduce((acc, p) => acc + (Number(p.valorRecebido) || 0), 0),
    [pagamentos],
  );

  const valorDinheiroDevido = useMemo(
    () =>
      pagamentos
        .filter((p) => p.forma === "dinheiro")
        .reduce((acc, p) => acc + (Number(p.valor) || 0), 0),
    [pagamentos],
  );

  const trocoTotal = useMemo(
    () => Math.max(0, totalRecebidoDinheiro - valorDinheiroDevido),
    [totalRecebidoDinheiro, valorDinheiroDevido],
  );

  const restante = useMemo(
    () => Number((totalEfetivo - totalPago).toFixed(2)),
    [totalEfetivo, totalPago],
  );

  const dinheiroInsuficiente = useMemo(() => {
    // Só bloqueia se houve pagamento em dinheiro e o recebido é menor que o devido
    return (
      valorDinheiroDevido > 0 && totalRecebidoDinheiro < valorDinheiroDevido - 0.005
    );
  }, [valorDinheiroDevido, totalRecebidoDinheiro]);

  // ============= Status de pagamento automático =============
  // pago: totalPago >= total e dinheiro suficiente
  // parcial: 0 < totalPago < total
  // pendente: totalPago == 0 ou somente formas "pendentePorPadrao" cobrindo
  const statusPagamento: StatusPagamento = useMemo(() => {
    if (Math.abs(totalPago - total) < 0.005 && !dinheiroInsuficiente) {
      // Se TODAS as linhas são "pendentePorPadrao" (boleto/fiado), considera pendente
      const todasPendentes =
        pagamentos.length > 0 &&
        pagamentos.every((p) => getFormaInfo(p.forma).pendentePorPadrao);
      return todasPendentes ? "pendente" : "pago";
    }
    if (totalPago > 0 && totalPago < total) return "parcial";
    if (totalPago === 0) return "pendente";
    return "pago";
  }, [totalPago, total, pagamentos, dinheiroInsuficiente]);

  // ===== Detecção de FIADO =====
  const temFiado = useMemo(
    () => pagamentos.some((p) => p.forma === "fiado"),
    [pagamentos],
  );
  const fiadoSemCliente = temFiado && !cliente;
  const fiadoSemVencimento = temFiado && !vencimentoFiado;

  // Forma "principal" = a de maior valor (apenas para o card de resumo)
  const formaPrincipal: FormaPagamento = useMemo(() => {
    if (pagamentos.length === 0) return "dinheiro";
    return [...pagamentos].sort((a, b) => b.valor - a.valor)[0].forma;
  }, [pagamentos]);

  // ============= Handlers de manipulação =============
  function addPagamento() {
    // O novo pagamento entra cobrindo o restante (se houver)
    const valorSugerido = Math.max(0, restante);
    setPagamentos((prev) => [...prev, novoPagamento("pix", valorSugerido)]);
    setTimeout(() => ultimoValorRef.current?.focus(), 50);
  }

  function removePagamento(uid: string) {
    setPagamentos((prev) => prev.filter((p) => p.uid !== uid));
  }

  function updatePagamento(uid: string, patch: Partial<PagamentoLinha>) {
    setPagamentos((prev) =>
      prev.map((p) => (p.uid === uid ? { ...p, ...patch } : p)),
    );
  }

  function setForma(uid: string, forma: FormaPagamento) {
    setPagamentos((prev) =>
      prev.map((p) => {
        if (p.uid !== uid) return p;
        const next: PagamentoLinha = { ...p, forma };
        // Se virou dinheiro e não tem valor recebido, sugere o próprio valor
        if (forma === "dinheiro" && (!p.valorRecebido || p.valorRecebido < p.valor)) {
          next.valorRecebido = p.valor;
        }
        if (forma !== "cartao_credito") next.parcelas = 1;
        return next;
      }),
    );
  }

  function setValor(uid: string, valor: number) {
    const v = Math.max(0, isNaN(valor) ? 0 : valor);
    setPagamentos((prev) =>
      prev.map((p) => {
        if (p.uid !== uid) return p;
        const next = { ...p, valor: v };
        // Para dinheiro, se o recebido era exatamente o valor antigo, sincroniza
        if (p.forma === "dinheiro" && Math.abs(p.valorRecebido - p.valor) < 0.005) {
          next.valorRecebido = v;
        }
        return next;
      }),
    );
  }

  function distribuirRestante(uid: string) {
    const r = restante;
    if (r <= 0) return;
    setPagamentos((prev) =>
      prev.map((p) =>
        p.uid === uid
          ? {
              ...p,
              valor: Number((p.valor + r).toFixed(2)),
              valorRecebido:
                p.forma === "dinheiro"
                  ? Number((p.valor + r).toFixed(2))
                  : p.valorRecebido,
            }
          : p,
      ),
    );
  }

  // ============= Confirmar =============
  function handleConfirmar() {
    if (itens.length === 0) return;
    if (dinheiroInsuficiente) return;
    if (pagamentos.length === 0) return;
    // Aceita pagar exatamente o total ou menos (parcial). Mais que o total só faz sentido em dinheiro (troco).
    if (totalPago > total + 0.005 && valorDinheiroDevido === 0) {
      return;
    }

    // ===== Validação FIADO =====
    if (fiadoSemCliente) {
      toast.error("Para vendas fiado é obrigatório selecionar um cliente.");
      onSelecionarCliente?.();
      return;
    }
    if (fiadoSemVencimento) {
      toast.error("Informe a data de vencimento para a venda fiado.");
      setTimeout(() => vencimentoInputRef.current?.focus(), 30);
      return;
    }
    if (totalPago < total - 0.005) {
      // Parcial — segue normalmente, mas o sistema gera lançamento pendente
    }

    const pagamentosPayload: FinalizarVendaPagamento[] = pagamentos.map((p) => {
      const isDinheiro = p.forma === "dinheiro";
      const trocoLinha = isDinheiro
        ? Math.max(0, p.valorRecebido - p.valor)
        : 0;
      return {
        forma_pagamento: p.forma,
        valor: Number(p.valor.toFixed(2)),
        valor_recebido: isDinheiro ? Number(p.valorRecebido.toFixed(2)) : null,
        troco: isDinheiro ? Number(trocoLinha.toFixed(2)) : null,
        parcelas: p.forma === "cartao_credito" ? p.parcelas : 1,
        observacao: null,
      };
    });

    finalizar.mutate(
      {
        cliente_id: cliente?.id ?? null,
        subtotal,
        desconto,
        total,
        // Mantém compat. com a coluna `vendas.forma_pagamento` — usa a principal
        forma_pagamento: formaPrincipal,
        status_pagamento: statusPagamento,
        valor_recebido: totalRecebidoDinheiro || null,
        troco: trocoTotal || null,
        observacao: [observacao, obsFinal].filter(Boolean).join(" — ") || null,
        itens,
        pagamentos: pagamentosPayload,
        operador_id: operador?.id ?? null,
        terminal_id: terminal?.id ?? null,
        client_uuid: clientUuid ?? null,
        data_vencimento: temFiado ? vencimentoFiado : null,
      },
      {
        onSuccess: (vendaId) => {
          onConfirmed({
            vendaId,
            forma: formaPrincipal,
            status: statusPagamento,
            troco: trocoTotal,
            valorRecebido: totalRecebidoDinheiro,
          });
        },
      },
    );
  }

  // ============= Atalhos de teclado =============
  const podeConfirmar =
    !finalizar.isPending &&
    itens.length > 0 &&
    !dinheiroInsuficiente &&
    pagamentos.length > 0 &&
    totalPago > 0 &&
    !fiadoSemCliente &&
    !fiadoSemVencimento;

  useHotkeys(
    [
      // F1-F6 → trocam a forma de pagamento da ÚLTIMA linha de pagamento
      ...FORMAS.map((f) => ({
        key: f.shortcut,
        allowInInputs: true,
        handler: () => {
          if (pagamentos.length === 0) return;
          const ultima = pagamentos[pagamentos.length - 1];
          setForma(ultima.uid, f.key);
          flashHotkey(f.shortcut);
        },
      })),
      {
        key: "Enter",
        allowInInputs: true, // Enter força confirmação mesmo dentro de inputs/buttons
        handler: (e) => {
          // Ignora auto-repeat de tecla pressionada
          if (e.repeat) return;

          // Só confirma se o foco estiver DENTRO do diálogo de finalização
          // (evita conflitos com modais sobrepostos, popovers ou foco fora).
          const dialogEl = dialogContentRef.current;
          const active = document.activeElement as HTMLElement | null;
          if (!dialogEl) return;
          if (active && !dialogEl.contains(active)) return;

          // Em textarea (observação), Enter deve quebrar linha — não confirma
          if (active && active.tagName === "TEXTAREA") return;

          // Só confirma se a venda estiver válida
          if (!podeConfirmar) return;

          // Previne o comportamento padrão (ex.: clicar no botão focado) e força confirmação
          e.preventDefault();
          handleConfirmar();
        },
      },
      {
        key: "Escape",
        allowInInputs: true,
        handler: () => {
          if (!finalizar.isPending) onOpenChange(false);
        },
      },
      {
        key: "Backspace",
        allowInInputs: false,
        handler: () => {
          if (!finalizar.isPending) onOpenChange(false);
        },
      },
    ],
    { enabled: open, scope: "modal" },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent ref={dialogContentRef} className="max-w-4xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border bg-muted/30 px-6 py-4">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Receipt className="h-5 w-5 text-primary" /> Finalizar venda
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Distribua o total entre uma ou mais formas de pagamento.</span>
            <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <Kbd>F1-F7</Kbd>
              <span>forma</span>
              <Kbd>Enter</Kbd>
              <span>confirmar</span>
              <Kbd>Esc</Kbd>
              <span>voltar</span>
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-0 md:grid-cols-[1fr_340px]">
          {/* ============ Esquerda — pagamentos ============ */}
          <div className="max-h-[65vh] space-y-4 overflow-y-auto p-6">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Pagamentos ({pagamentos.length})
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addPagamento}
                disabled={finalizar.isPending}
                className="gap-1"
              >
                <Plus className="h-3.5 w-3.5" /> Adicionar pagamento
              </Button>
            </div>

            {pagamentos.map((p, idx) => {
              const info = getFormaInfo(p.forma);
              const isDinheiro = p.forma === "dinheiro";
              const isCredito = p.forma === "cartao_credito";
              const trocoLinha = isDinheiro
                ? Math.max(0, p.valorRecebido - p.valor)
                : 0;
              const faltaLinha = isDinheiro
                ? Math.max(0, p.valor - p.valorRecebido)
                : 0;
              return (
                <div
                  key={p.uid}
                  className="rounded-lg border border-border bg-card/40 p-3 shadow-sm"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-xs text-primary">
                        {idx + 1}
                      </span>
                      <info.icon className="h-4 w-4 text-muted-foreground" />
                      <span>{info.label}</span>
                    </div>
                    {pagamentos.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => removePagamento(p.uid)}
                        disabled={finalizar.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>

                  {/* Seletor de forma */}
                  <div className="mb-3 grid grid-cols-4 gap-1.5 sm:grid-cols-7">
                    {FORMAS.map((f) => {
                      const Icon = f.icon;
                      const active = p.forma === f.key;
                      const isLast = idx === pagamentos.length - 1;
                      const flashing = isLast && hotkeyFlash === f.shortcut;
                      return (
                        <button
                          key={f.key}
                          type="button"
                          onClick={() => setForma(p.uid, f.key)}
                          title={`${f.label} (${f.shortcut})`}
                          className={cn(
                            "relative flex flex-col items-center justify-center gap-1 rounded-md border px-1 py-2 pt-3 text-[11px] font-medium transition-all",
                            active
                              ? "border-primary bg-primary/10 text-primary shadow-sm"
                              : "border-border bg-card hover:border-primary/40 hover:bg-muted/40",
                            flashing && "scale-105 ring-2 ring-primary ring-offset-1 ring-offset-background",
                          )}
                        >
                          <span
                            className={cn(
                              "absolute right-1 top-0.5 rounded px-1 font-mono text-[9px] leading-tight",
                              active
                                ? "bg-primary/20 text-primary"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {f.shortcut}
                          </span>
                          <Icon className="h-4 w-4" />
                          {f.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Valor + (recebido / parcelas) */}
                  <div
                    className={cn(
                      "grid gap-2",
                      isDinheiro || isCredito
                        ? "grid-cols-[1fr_1fr_auto]"
                        : "grid-cols-[1fr_auto]",
                    )}
                  >
                    <div>
                      <Label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
                        Valor
                      </Label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                          R$
                        </span>
                        <Input
                          ref={idx === pagamentos.length - 1 ? ultimoValorRef : undefined}
                          type="number"
                          step="0.01"
                          min="0"
                          value={p.valor === 0 ? "" : p.valor}
                          onChange={(e) =>
                            setValor(p.uid, parseFloat(e.target.value))
                          }
                          className="h-10 pl-9 font-mono tabular-nums"
                        />
                      </div>
                    </div>

                    {isDinheiro && (
                      <div>
                        <Label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
                          Recebido
                        </Label>
                        <div className="relative">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                            R$
                          </span>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={p.valorRecebido === 0 ? "" : p.valorRecebido}
                            onChange={(e) =>
                              updatePagamento(p.uid, {
                                valorRecebido: Math.max(
                                  0,
                                  parseFloat(e.target.value) || 0,
                                ),
                              })
                            }
                            className="h-10 pl-9 font-mono tabular-nums"
                          />
                        </div>
                      </div>
                    )}

                    {isCredito && (
                      <div>
                        <Label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
                          Parcelas
                        </Label>
                        <select
                          value={p.parcelas}
                          onChange={(e) =>
                            updatePagamento(p.uid, {
                              parcelas: Number(e.target.value),
                            })
                          }
                          className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                        >
                          {[1, 2, 3, 4, 6, 10, 12].map((n) => (
                            <option key={n} value={n}>
                              {n}x
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {restante > 0.005 && (
                      <div className="flex items-end">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-10 whitespace-nowrap text-xs"
                          onClick={() => distribuirRestante(p.uid)}
                          title={`Adiciona o restante de ${formatBRL(restante)}`}
                        >
                          + {formatBRL(restante)}
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Feedback por linha */}
                  {isDinheiro && (
                    <div className="mt-2 flex items-center justify-between text-xs">
                      {trocoLinha > 0 && (
                        <span className="font-medium text-success">
                          Troco: {formatBRL(trocoLinha)}
                        </span>
                      )}
                      {faltaLinha > 0 && (
                        <span className="font-medium text-destructive">
                          Falta: {formatBRL(faltaLinha)}
                        </span>
                      )}
                      {trocoLinha === 0 && faltaLinha === 0 && (
                        <span className="text-muted-foreground">Valor exato</span>
                      )}
                    </div>
                  )}
                  {isCredito && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {p.parcelas}x de{" "}
                      <span className="font-medium tabular-nums text-foreground">
                        {formatBRL(p.valor / Math.max(1, p.parcelas))}
                      </span>
                    </p>
                  )}
                </div>
              );
            })}

            {/* Atalhos rápidos de divisão */}
            {pagamentos.length === 1 && total > 0 && (
              <div className="flex flex-wrap gap-1.5">
                <span className="text-xs text-muted-foreground">Dividir:</span>
                {[2, 3].map((n) => (
                  <Button
                    key={n}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      const parte = Number((total / n).toFixed(2));
                      const linhas: PagamentoLinha[] = [];
                      let acumulado = 0;
                      for (let i = 0; i < n; i++) {
                        const v =
                          i === n - 1
                            ? Number((total - acumulado).toFixed(2))
                            : parte;
                        acumulado += v;
                        const forma: FormaPagamento =
                          i === 0 ? "dinheiro" : i === 1 ? "pix" : "cartao_debito";
                        const linha = novoPagamento(forma, v);
                        if (forma === "dinheiro") linha.valorRecebido = v;
                        linhas.push(linha);
                      }
                      setPagamentos(linhas);
                    }}
                  >
                    {n}x partes iguais
                  </Button>
                ))}
              </div>
            )}

            {/* ============ FIADO: cliente + vencimento obrigatórios ============ */}
            {temFiado && (
              <div
                className={cn(
                  "rounded-lg border-2 p-3 transition-colors",
                  fiadoSemCliente || fiadoSemVencimento
                    ? "border-destructive/60 bg-destructive/5"
                    : "border-warning/40 bg-warning/5",
                )}
              >
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Venda fiado exige cliente e vencimento
                </p>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="text-muted-foreground">Cliente: </span>
                    {cliente ? (
                      <span className="font-medium text-foreground">{cliente.nome}</span>
                    ) : (
                      <span className="font-medium text-destructive">não selecionado</span>
                    )}
                  </div>
                  {!cliente && onSelecionarCliente && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onSelecionarCliente()}
                      className="h-8 gap-1.5"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      Selecionar / cadastrar
                    </Button>
                  )}
                </div>
                <div>
                  <Label
                    htmlFor="venc-fiado"
                    className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground"
                  >
                    Data de vencimento *
                  </Label>
                  <Input
                    ref={vencimentoInputRef}
                    id="venc-fiado"
                    type="date"
                    value={vencimentoFiado}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setVencimentoFiado(e.target.value)}
                    className={cn(
                      "h-10 max-w-[220px] font-mono",
                      fiadoSemVencimento && "border-destructive ring-1 ring-destructive",
                    )}
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Sugerido: +30 dias da data atual
                  </p>
                </div>
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

              <div className="rounded-lg border border-border bg-card/60 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Distribuído</span>
                  <span className="font-mono font-semibold tabular-nums">
                    {formatBRL(totalPago)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-muted-foreground">Restante</span>
                  <span
                    className={cn(
                      "font-mono font-semibold tabular-nums",
                      Math.abs(restante) < 0.005
                        ? "text-success"
                        : restante > 0
                          ? "text-warning"
                          : "text-destructive",
                    )}
                  >
                    {formatBRL(restante)}
                  </span>
                </div>
              </div>

              {trocoTotal > 0 && (
                <div className="rounded-lg border-2 border-success/40 bg-success/10 p-3 text-success">
                  <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide">
                    <ArrowRightLeft className="h-3.5 w-3.5" /> Troco para o cliente
                  </p>
                  <p className="font-mono text-2xl font-bold tabular-nums">
                    {formatBRL(trocoTotal)}
                  </p>
                </div>
              )}

              <div className="space-y-1 border-t border-border pt-4 text-xs text-muted-foreground">
                <p className="flex items-center gap-1.5">
                  <Wallet className="h-3.5 w-3.5" />
                  <span>
                    Status:{" "}
                    <Badge
                      variant="outline"
                      className={cn("capitalize", STATUS_COLORS[statusPagamento])}
                    >
                      {statusPagamento}
                    </Badge>
                  </span>
                </p>
                {cliente && (
                  <p>
                    Cliente:{" "}
                    <span className="text-foreground">{cliente.nome}</span>
                  </p>
                )}
                {!cliente && <p>Cliente: Consumidor</p>}
                {(operador?.nome || operadorEmail) && (
                  <p>
                    Operador:{" "}
                    <span className="text-foreground">
                      {operador?.nome ?? operadorEmail}
                    </span>
                  </p>
                )}
                <p>
                  Data:{" "}
                  <span className="text-foreground">
                    {new Date().toLocaleString("pt-BR")}
                  </span>
                </p>
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
            <Kbd className="ml-1">Esc</Kbd>
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
              className="h-11 min-w-[220px]"
              onClick={handleConfirmar}
              disabled={
                finalizar.isPending ||
                itens.length === 0 ||
                dinheiroInsuficiente ||
                pagamentos.length === 0 ||
                totalPago <= 0 ||
                fiadoSemCliente ||
                fiadoSemVencimento
              }
            >
              {finalizar.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Confirmar venda
              <Kbd className="ml-1 border-primary-foreground/30 bg-primary-foreground/15 text-primary-foreground">
                Enter
              </Kbd>
            </Button>
          </div>
        </div>

        {dinheiroInsuficiente && (
          <div className="border-t border-destructive/30 bg-destructive/10 px-6 py-2 text-center text-xs font-medium text-destructive">
            Há pagamento em dinheiro com valor recebido menor que o devido. Ajuste
            o valor recebido.
          </div>
        )}
        {fiadoSemCliente && (
          <div className="border-t border-destructive/30 bg-destructive/10 px-6 py-2 text-center text-xs font-medium text-destructive">
            Para vendas fiado é obrigatório selecionar um cliente.
          </div>
        )}
        {!fiadoSemCliente && fiadoSemVencimento && (
          <div className="border-t border-destructive/30 bg-destructive/10 px-6 py-2 text-center text-xs font-medium text-destructive">
            Informe a data de vencimento para a venda fiado.
          </div>
        )}
        {!dinheiroInsuficiente && !fiadoSemCliente && !fiadoSemVencimento && restante > 0.005 && (
          <div className="border-t border-warning/30 bg-warning/10 px-6 py-2 text-center text-xs font-medium text-warning">
            Restam {formatBRL(restante)} a distribuir. A venda será registrada
            como <strong>parcial</strong>.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SummaryRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}

function Kbd({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground shadow-sm",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
