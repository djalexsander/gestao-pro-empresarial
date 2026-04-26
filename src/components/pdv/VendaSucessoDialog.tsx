import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  Package,
  Wallet,
  Receipt,
  Plus,
  ListChecks,
  ArrowRightLeft,
  Printer,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/mock-data";
import { toast } from "sonner";
import type { StatusPagamento, FormaPagamento } from "@/hooks/useVendas";
import { useConfigEmpresa } from "@/hooks/useConfigEmpresa";
import { imprimirCupom, baixarCupomHtml, type CupomItem } from "@/lib/cupom";
import { useHotkeys } from "@/hooks/useHotkeys";

interface VendaSucessoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  venda: {
    id: string;
    numero?: string | null;
    total: number;
    subtotal: number;
    desconto: number;
    totalItens: number;
    forma: FormaPagamento;
    status: StatusPagamento;
    troco: number;
    valorRecebido?: number | null;
    cliente: { nome: string; documento?: string | null } | null;
    operador?: string | null;
    observacao?: string | null;
    itens: CupomItem[];
    data: Date;
  } | null;
  onNovaVenda: () => void;
  onVerVendas: () => void;
}

const STATUS_BADGE: Record<StatusPagamento, string> = {
  pago: "bg-success/15 text-success border-success/30",
  pendente: "bg-warning/15 text-warning border-warning/30",
  parcial: "bg-primary/15 text-primary border-primary/30",
  cancelado: "bg-destructive/15 text-destructive border-destructive/30",
};

const FORMA_LABEL: Record<FormaPagamento, string> = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  cartao_debito: "Cartão de débito",
  cartao_credito: "Cartão de crédito",
  boleto: "Boleto",
  ifood: "iFood",
  fiado: "Fiado",
  transferencia: "Transferência",
  cheque: "Cheque",
  outro: "Outro",
};

export function VendaSucessoDialog({
  open,
  onOpenChange,
  venda,
  onNovaVenda,
  onVerVendas,
}: VendaSucessoDialogProps) {
  const { data: empresa } = useConfigEmpresa();

  function buildCupom() {
    if (!venda) return null;
    return {
      numero: venda.numero ?? null,
      data: venda.data,
      operador: venda.operador ?? null,
      cliente: venda.cliente,
      itens: venda.itens,
      subtotal: venda.subtotal,
      desconto: venda.desconto,
      total: venda.total,
      totalItens: venda.totalItens,
      forma: venda.forma,
      status: venda.status,
      valorRecebido: venda.valorRecebido ?? null,
      troco: venda.troco,
      observacao: venda.observacao ?? null,
    };
  }

  function handleImprimir() {
    const cupom = buildCupom();
    if (!cupom) return;
    const ok = imprimirCupom(empresa ?? null, cupom);
    if (!ok) {
      toast.error(
        "Não foi possível abrir a janela de impressão. Permita pop-ups deste site e tente novamente.",
      );
    }
  }

  function handleBaixarPdf() {
    const cupom = buildCupom();
    if (!cupom) return;
    const ok = baixarCupomHtml(empresa ?? null, cupom);
    if (ok) {
      toast.success(
        "Cupom baixado. Abra o arquivo e use 'Salvar como PDF' do navegador.",
      );
    } else {
      toast.error("Não foi possível baixar o cupom.");
    }
  }

  // Atalhos contextuais desta tela. Escopo "modal": tem prioridade sobre o
  // PDV subjacente — Enter/Esc/V aqui não conflitam com atalhos do PDV.
  // Cleanup automático ao fechar libera os atalhos para o resto do sistema.
  useHotkeys(
    [
      { key: "F5", handler: handleImprimir, allowInInputs: true },
      { key: "p", ctrl: true, handler: handleImprimir, allowInInputs: true },
      { key: "Enter", handler: () => onNovaVenda(), allowInInputs: true },
      { key: "Escape", handler: () => onOpenChange(false), allowInInputs: true },
      { key: "v", handler: () => onVerVendas() },
    ],
    { enabled: open && !!venda, scope: "modal" },
  );

  if (!venda) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border bg-success/10 px-6 py-5 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/20 text-success">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <DialogTitle className="mt-3 text-xl">Venda concluída!</DialogTitle>
          <DialogDescription>
            A operação foi registrada com sucesso no sistema.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 p-6">
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-center">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Total da venda
            </p>
            <p className="font-mono text-3xl font-bold tabular-nums text-primary">
              {formatBRL(venda.total)}
            </p>
            <div className="mt-2 flex items-center justify-center gap-2 text-xs">
              <span className="font-mono text-muted-foreground">
                {venda.numero ?? "—"}
              </span>
              <Badge
                variant="outline"
                className={cn("capitalize", STATUS_BADGE[venda.status])}
              >
                {venda.status}
              </Badge>
            </div>
          </div>

          {venda.troco > 0 && (
            <div className="flex items-center justify-between rounded-md border-2 border-success/40 bg-success/10 p-3 text-success">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <ArrowRightLeft className="h-4 w-4" /> Troco para o cliente
              </span>
              <span className="font-mono text-lg font-bold tabular-nums">
                {formatBRL(venda.troco)}
              </span>
            </div>
          )}

          <ul className="space-y-2 text-sm">
            <ConfirmRow
              icon={Package}
              label="Estoque atualizado"
              detail={`${venda.totalItens.toFixed(0)} unidades baixadas`}
            />
            <ConfirmRow
              icon={Wallet}
              label="Financeiro registrado"
              detail={
                venda.status === "pago"
                  ? "Recebimento lançado"
                  : venda.status === "parcial"
                    ? "Parcial lançado, restante pendente"
                    : venda.status === "pendente"
                      ? "Conta a receber gerada"
                      : "Sem reflexo financeiro"
              }
            />
            <ConfirmRow
              icon={Receipt}
              label="Forma de pagamento"
              detail={FORMA_LABEL[venda.forma]}
            />
            {venda.cliente && (
              <ConfirmRow
                icon={CheckCircle2}
                label="Cliente"
                detail={venda.cliente.nome}
              />
            )}
          </ul>

          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={handleImprimir}>
              <Printer className="h-4 w-4" /> Imprimir
              <Kbd>F5</Kbd>
            </Button>
            <Button variant="outline" onClick={handleBaixarPdf}>
              <Download className="h-4 w-4" /> Baixar PDF
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-border bg-muted/20 p-4">
          <Button variant="outline" onClick={onVerVendas}>
            <ListChecks className="h-4 w-4" /> Ver vendas
            <Kbd>V</Kbd>
          </Button>
          <Button onClick={onNovaVenda} autoFocus>
            <Plus className="h-4 w-4" /> Nova venda
            <Kbd variant="primary">Enter</Kbd>
          </Button>
        </div>

        <div className="border-t border-border bg-muted/10 px-4 py-2 text-center text-[10px] uppercase tracking-wide text-muted-foreground">
          Esc fechar · Ctrl+P imprimir (alternativa)
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Kbd({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "primary";
}) {
  return (
    <kbd
      className={cn(
        "ml-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none",
        variant === "primary"
          ? "border-primary-foreground/30 bg-primary-foreground/15 text-primary-foreground"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      {children}
    </kbd>
  );
}

function ConfirmRow({
  icon: Icon,
  label,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail: string;
}) {
  return (
    <li className="flex items-start gap-3 rounded-md border border-border/60 bg-card p-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-success/15 text-success">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
      <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
    </li>
  );
}
