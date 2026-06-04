import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Receipt,
  User,
  Calendar,
  Wallet,
  Pencil,
  History,
} from "lucide-react";
import {
  useVendaDetalhe,
  useAlterarStatusVenda,
  useVendaStatusHistorico,
  type StatusVendaEditavel,
} from "@/hooks/useVendas";
import { formatBRL } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const STATUS_BADGE: Record<string, string> = {
  pago: "bg-success/15 text-success border-success/30",
  pendente: "bg-warning/15 text-warning border-warning/30",
  parcial: "bg-primary/15 text-primary border-primary/30",
  vencido: "bg-destructive/15 text-destructive border-destructive/30",
  cancelado: "bg-destructive/15 text-destructive border-destructive/30",
};

const SYNC_LABEL: Record<string, string> = {
  pending: "Pendente sync",
  sending: "Sincronizando",
  sent: "Sincronizada",
  error: "Erro sync",
};

const SYNC_BADGE: Record<string, string> = {
  pending: "bg-warning/15 text-warning border-warning/30",
  sending: "bg-primary/15 text-primary border-primary/30",
  sent: "bg-success/15 text-success border-success/30",
  error: "bg-destructive/15 text-destructive border-destructive/30",
};

const ORIGEM_LABEL: Record<string, string> = {
  financeiro: "Financeiro",
  vendas: "Vendas",
  sistema: "Sistema",
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
  const { data: historico = [] } = useVendaStatusHistorico(open ? vendaId : null);
  const alterar = useAlterarStatusVenda();

  const [editando, setEditando] = useState(false);
  const [novoStatus, setNovoStatus] = useState<StatusVendaEditavel>("pago");
  const [motivo, setMotivo] = useState("");
  const syncStatus = data?.cancel_sync_status ?? data?.sync_status ?? null;
  const bloqueiaStatusLocal = Boolean(syncStatus && syncStatus !== "sent");

  const handleSalvar = async () => {
    if (!vendaId) return;
    try {
      await alterar.mutateAsync({
        venda_id: vendaId,
        novo_status: novoStatus,
        motivo: motivo || null,
      });
      setEditando(false);
      setMotivo("");
    } catch {
      /* toast já tratado */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
                <div className="flex flex-wrap gap-1.5">
                  <Badge
                    variant="outline"
                    className={cn(
                      "capitalize",
                      STATUS_BADGE[data.status_pagamento] ?? "",
                    )}
                  >
                    {data.status_pagamento}
                  </Badge>
                  {syncStatus && (
                    <Badge
                      variant="outline"
                      className={cn("whitespace-nowrap", SYNC_BADGE[syncStatus] ?? "")}
                      title={data.sync_error ?? undefined}
                    >
                      {SYNC_LABEL[syncStatus] ?? syncStatus}
                    </Badge>
                  )}
                </div>
              </Info>
            </div>

            {/* Editar status */}
            {data.status !== "cancelada" && (
              <div className="rounded-md border border-border bg-muted/10 p-3">
                {!editando ? (
                  <>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm text-muted-foreground">
                      Status atual: <strong className="capitalize text-foreground">{data.status_pagamento}</strong>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      disabled={bloqueiaStatusLocal}
                      onClick={() => {
                        setNovoStatus(
                          (data.status_pagamento as StatusVendaEditavel) ?? "pendente",
                        );
                        setEditando(true);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Editar status
                    </Button>
                  </div>
                  {bloqueiaStatusLocal && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      A edição de status fica bloqueada enquanto a venda local
                      ainda não sincronizou.
                    </p>
                  )}
                  </>
                ) : (
                  <div className="space-y-2">
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                      <Select
                        value={novoStatus}
                        onValueChange={(v) => setNovoStatus(v as StatusVendaEditavel)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pago">Pago</SelectItem>
                          <SelectItem value="parcial">Parcial</SelectItem>
                          <SelectItem value="pendente">Pendente</SelectItem>
                          <SelectItem value="vencido">Vencido</SelectItem>
                          <SelectItem value="cancelado">Cancelado</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditando(false)}
                          disabled={alterar.isPending}
                        >
                          Cancelar
                        </Button>
                        <Button
                          size="sm"
                          onClick={handleSalvar}
                          disabled={alterar.isPending}
                        >
                          {alterar.isPending && (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          )}
                          Salvar
                        </Button>
                      </div>
                    </div>
                    <input
                      placeholder="Motivo (opcional)"
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      O lançamento financeiro vinculado será atualizado automaticamente.
                    </p>
                  </div>
                )}
              </div>
            )}

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
                {data.valor_pago_total > 0 && (
                  <SummaryRow label="Valor pago">
                    <span className="text-success">{formatBRL(data.valor_pago_total)}</span>
                  </SummaryRow>
                )}
                {data.valor_restante > 0.005 && (
                  <SummaryRow label="Restante">
                    <span className="text-warning">{formatBRL(data.valor_restante)}</span>
                  </SummaryRow>
                )}
                {data.troco != null && data.troco > 0 && (
                  <SummaryRow label="Troco">
                    <span className="text-success">{formatBRL(data.troco)}</span>
                  </SummaryRow>
                )}
              </div>
            </div>

            {/* Pagamentos */}
            {data.pagamentos.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Pagamentos ({data.pagamentos.length})
                </p>
                <div className="overflow-hidden rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left">Forma</th>
                        <th className="px-3 py-2 text-right">Valor</th>
                        <th className="px-3 py-2 text-center">Parcelas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.pagamentos.map((p) => (
                        <tr key={p.id} className="border-t border-border/60">
                          <td className="px-3 py-2 capitalize">
                            {p.forma_pagamento.replace(/_/g, " ")}
                          </td>
                          <td className="px-3 py-2 text-right font-medium tabular-nums">
                            {formatBRL(p.valor)}
                          </td>
                          <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">
                            {p.parcelas && p.parcelas > 1 ? `${p.parcelas}x` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Histórico */}
            {historico.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <History className="h-3 w-3" /> Histórico de status ({historico.length})
                </p>
                <div className="space-y-1.5">
                  {historico.slice(0, 8).map((h) => (
                    <div
                      key={h.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/10 px-3 py-1.5 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        {h.status_anterior && (
                          <>
                            <Badge
                              variant="outline"
                              className={cn("capitalize text-[10px]", STATUS_BADGE[h.status_anterior] ?? "")}
                            >
                              {h.status_anterior}
                            </Badge>
                            <span className="text-muted-foreground">→</span>
                          </>
                        )}
                        <Badge
                          variant="outline"
                          className={cn("capitalize text-[10px]", STATUS_BADGE[h.status_novo] ?? "")}
                        >
                          {h.status_novo}
                        </Badge>
                        <span className="text-muted-foreground">
                          via {ORIGEM_LABEL[h.origem]}
                        </span>
                      </div>
                      <span className="text-muted-foreground tabular-nums">
                        {new Date(h.created_at).toLocaleString("pt-BR")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
