import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, Receipt, User, Calendar, Wallet } from "lucide-react";
import { useVendaDetalhe } from "@/hooks/useVendas";
import { formatBRL } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const STATUS_BADGE: Record<string, string> = {
  pago: "bg-success/15 text-success border-success/30",
  pendente: "bg-warning/15 text-warning border-warning/30",
  parcial: "bg-primary/15 text-primary border-primary/30",
  cancelado: "bg-destructive/15 text-destructive border-destructive/30",
};

interface DetalheVendaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendaId: string | null;
}

export function DetalheVendaDialog({
  open,
  onOpenChange,
  vendaId,
}: DetalheVendaDialogProps) {
  const { data, isLoading } = useVendaDetalhe(open ? vendaId : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-primary" />
            Detalhe da venda {data?.numero ?? ""}
          </DialogTitle>
          <DialogDescription>
            Informações completas da venda, itens, pagamento e rastreabilidade.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !data ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Header info */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Info icon={Calendar} label="Data">
                {new Date(data.data_emissao + "T00:00:00").toLocaleDateString("pt-BR")}
              </Info>
              <Info icon={User} label="Cliente">
                {data.cliente_nome ?? "Consumidor"}
              </Info>
              <Info icon={Wallet} label="Pagamento">
                {data.forma_pagamento ?? "—"}
              </Info>
              <Info icon={Receipt} label="Status">
                <Badge
                  variant="outline"
                  className={cn(
                    "capitalize",
                    STATUS_BADGE[data.status_pagamento] ?? "",
                  )}
                >
                  {data.status_pagamento}
                </Badge>
              </Info>
            </div>

            {/* Itens */}
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Produto</th>
                    <th className="px-3 py-2 text-center">Qtd</th>
                    <th className="px-3 py-2 text-right">Unitário</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.itens.map((it) => (
                    <tr key={it.id} className="border-t border-border/60">
                      <td className="px-3 py-2">
                        <div className="font-medium">
                          {it.produto_nome ?? it.descricao ?? "—"}
                        </div>
                        {it.sku && (
                          <div className="font-mono text-xs text-muted-foreground">
                            {it.sku}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums">
                        {it.quantidade}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatBRL(it.preco_unitario)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {formatBRL(it.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totais */}
            <div className="flex justify-end">
              <div className="w-full max-w-xs space-y-1.5 text-sm">
                <SummaryRow label="Subtotal">{formatBRL(data.subtotal)}</SummaryRow>
                {data.desconto > 0 && (
                  <SummaryRow label="Desconto">
                    <span className="text-warning">- {formatBRL(data.desconto)}</span>
                  </SummaryRow>
                )}
                <div className="flex items-center justify-between border-t border-border pt-2 text-base font-semibold">
                  <span>Total</span>
                  <span className="font-mono tabular-nums text-primary">
                    {formatBRL(data.total)}
                  </span>
                </div>
                {data.valor_recebido != null && data.valor_recebido > 0 && (
                  <SummaryRow label="Valor recebido">
                    {formatBRL(data.valor_recebido)}
                  </SummaryRow>
                )}
                {data.troco != null && data.troco > 0 && (
                  <SummaryRow label="Troco">
                    <span className="text-success">{formatBRL(data.troco)}</span>
                  </SummaryRow>
                )}
              </div>
            </div>

            {data.observacoes && (
              <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground whitespace-pre-wrap">
                {data.observacoes}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Info({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-2.5">
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </p>
      <div className="mt-1 text-sm font-medium">{children}</div>
    </div>
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
