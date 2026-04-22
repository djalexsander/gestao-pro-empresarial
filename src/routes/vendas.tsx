import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Plus, Search, Eye, X, Loader2, ShoppingBag } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL } from "@/lib/mock-data";
import { useVendas, type VendaListItem } from "@/hooks/useVendas";
import { CancelarVendaDialog } from "@/components/vendas/CancelarVendaDialog";
import { DetalheVendaDialog } from "@/components/vendas/DetalheVendaDialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/vendas")({
  head: () => ({
    meta: [
      { title: "Vendas — Gestão Pro" },
      { name: "description", content: "Pedidos de venda e atendimento a clientes." },
    ],
  }),
  component: SalesPage,
});

const STATUS_BADGE: Record<string, string> = {
  pago: "bg-success/15 text-success border-success/30",
  pendente: "bg-warning/15 text-warning border-warning/30",
  parcial: "bg-primary/15 text-primary border-primary/30",
  cancelado: "bg-destructive/15 text-destructive border-destructive/30",
};

const FORMA_LABEL: Record<string, string> = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  cartao_debito: "Débito",
  cartao_credito: "Crédito",
  boleto: "Boleto",
  transferencia: "Transferência",
  cheque: "Cheque",
  outro: "Fiado",
};

function SalesPage() {
  const navigate = useNavigate();
  const { data: vendas = [], isLoading } = useVendas();
  const [query, setQuery] = useState("");
  const [cancelar, setCancelar] = useState<VendaListItem | null>(null);
  const [detalheId, setDetalheId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vendas;
    return vendas.filter(
      (v) =>
        v.numero.toLowerCase().includes(q) ||
        (v.cliente_nome ?? "").toLowerCase().includes(q),
    );
  }, [vendas, query]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vendas"
        description="Pedidos de venda registrados no sistema."
        actions={
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => navigate({ to: "/pdv" })}
          >
            <Plus className="h-4 w-4" />
            Nova venda
          </Button>
        }
      />

      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por número ou cliente..."
              className="pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-60 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <ShoppingBag className="h-10 w-10 opacity-40" />
              <p className="font-medium">Nenhuma venda encontrada</p>
              <p className="text-sm">
                {query
                  ? "Tente outros termos de busca."
                  : "Inicie sua primeira venda no PDV."}
              </p>
              <Button
                size="sm"
                className="mt-2"
                onClick={() => navigate({ to: "/pdv" })}
              >
                <Plus className="h-4 w-4" /> Abrir PDV
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Pagamento</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((v) => {
                  const cancelada = v.status === "cancelada";
                  return (
                    <TableRow
                      key={v.id}
                      className={cn(cancelada && "opacity-60")}
                    >
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {v.numero}
                      </TableCell>
                      <TableCell className="font-medium">
                        {v.cliente_nome ?? (
                          <span className="text-muted-foreground">Consumidor</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(v.data_emissao + "T00:00:00").toLocaleDateString(
                          "pt-BR",
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {v.forma_pagamento
                          ? FORMA_LABEL[v.forma_pagamento] ?? v.forma_pagamento
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatBRL(v.total)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "capitalize",
                            STATUS_BADGE[v.status_pagamento] ?? "",
                          )}
                        >
                          {v.status_pagamento}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setDetalheId(v.id)}
                            title="Ver detalhes"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {!cancelada && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => setCancelar(v)}
                              title="Cancelar venda (estorna estoque + financeiro)"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CancelarVendaDialog
        open={cancelar !== null}
        onOpenChange={(o) => !o && setCancelar(null)}
        venda={
          cancelar
            ? { id: cancelar.id, numero: cancelar.numero, total: cancelar.total }
            : null
        }
        onCancelled={() => {
          // Fechado pelo botão "Concluir" no resumo — apenas reseta seleção
          setCancelar(null);
        }}
      />

      <DetalheVendaDialog
        open={detalheId !== null}
        onOpenChange={(o) => !o && setDetalheId(null)}
        vendaId={detalheId}
      />
    </div>
  );
}
