import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, PackageCheck, CalendarClock, Save } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useCompra, useUpdateCompraStatus, useUpdateCompraMetadados } from "@/hooks/useCompras";
import { ReceberCompraDialog } from "./ReceberCompraDialog";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  compraId: string | null;
}

const fmtBRL = (n: number) =>
  Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtNum = (n: number) =>
  Number(n ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 });

export function CompraDetailDialog({ open, onOpenChange, compraId }: Props) {
  const { data: compra, isLoading } = useCompra(compraId ?? undefined);
  const updateStatus = useUpdateCompraStatus();
  const updateMeta = useUpdateCompraMetadados();
  const [receberOpen, setReceberOpen] = useState(false);
  const [editVenc, setEditVenc] = useState("");
  const [editNf, setEditNf] = useState("");

  useEffect(() => {
    if (compra) {
      setEditVenc(compra.data_vencimento ?? "");
      setEditNf(compra.numero_nf ?? "");
    }
  }, [compra]);

  const metaDirty =
    !!compra &&
    ((editVenc || null) !== (compra.data_vencimento ?? null) ||
      (editNf || null) !== (compra.numero_nf ?? null));

  async function handleSalvarMeta() {
    if (!compraId) return;
    await updateMeta.mutateAsync({
      id: compraId,
      data_vencimento: editVenc || null,
      numero_nf: editNf || null,
    });
  }

  async function handleCancelar() {
    if (!compraId) return;
    await updateStatus.mutateAsync({ id: compraId, status: "cancelada" });
    onOpenChange(false);
  }

  const podeReceber =
    compra && compra.status !== "recebida" && compra.status !== "cancelada";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              Compra {compra?.numero ?? ""}
              {compra && <StatusBadge status={compra.status} />}
            </DialogTitle>
            <DialogDescription>
              {compra?.fornecedor
                ? compra.fornecedor.nome_fantasia || compra.fornecedor.razao_social
                : "Sem fornecedor vinculado"}
            </DialogDescription>
          </DialogHeader>

          {isLoading || !compra ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Emissão</p>
                  <p className="font-medium">
                    {new Date(compra.data_emissao).toLocaleDateString("pt-BR")}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Previsão</p>
                  <p className="font-medium">
                    {compra.data_prevista
                      ? new Date(compra.data_prevista).toLocaleDateString("pt-BR")
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Recebido em</p>
                  <p className="font-medium">
                    {compra.data_recebimento
                      ? new Date(compra.data_recebimento).toLocaleDateString("pt-BR")
                      : "—"}
                  </p>
                </div>
              </div>

              {/* Metadados financeiros editáveis */}
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <CalendarClock className="h-3.5 w-3.5" />
                  Vencimento financeiro
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Data de vencimento</Label>
                    <Input
                      type="date"
                      value={editVenc}
                      onChange={(e) => setEditVenc(e.target.value)}
                      disabled={compra.status === "cancelada"}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Nº NF</Label>
                    <Input
                      value={editNf}
                      onChange={(e) => setEditNf(e.target.value)}
                      disabled={compra.status === "cancelada"}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      size="sm"
                      onClick={handleSalvarMeta}
                      disabled={!metaDirty || updateMeta.isPending || compra.status === "cancelada"}
                      className="gap-1.5 w-full"
                    >
                      <Save className="h-3.5 w-3.5" />
                      {updateMeta.isPending ? "Salvando..." : "Salvar"}
                    </Button>
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Alterar o vencimento sincroniza automaticamente o título em <strong>Contas a Pagar</strong>.
                </p>
              </div>

              <div className="rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      <TableHead className="text-right">Qtd</TableHead>
                      <TableHead className="text-right">Recebido</TableHead>
                      <TableHead className="text-right">Custo</TableHead>
                      <TableHead className="text-right">Subtotal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {compra.itens?.map((it) => {
                      const total = Number(it.quantidade);
                      const recebido = Number(it.quantidade_recebida ?? 0);
                      const completo = recebido >= total;
                      return (
                        <TableRow key={it.id}>
                          <TableCell className="font-medium">
                            {it.produto?.nome ?? "—"}
                            {it.produto?.sku && (
                              <span className="ml-2 font-mono text-xs text-muted-foreground">
                                {it.produto.sku}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{fmtNum(total)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            <Badge variant="outline" className={completo ? "border-success/30 text-success" : ""}>
                              {fmtNum(recebido)} / {fmtNum(total)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtBRL(Number(it.preco_unitario))}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium">
                            {fmtBRL(Number(it.total))}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
                <Row label="Subtotal" value={fmtBRL(Number(compra.subtotal))} />
                <Row label="Desconto" value={`- ${fmtBRL(Number(compra.desconto))}`} />
                <Row label="Frete" value={fmtBRL(Number(compra.frete))} />
                <Row label="Outros" value={fmtBRL(Number(compra.outros))} />
                <Separator className="my-2" />
                <div className="flex items-center justify-between text-base font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums">{fmtBRL(Number(compra.total))}</span>
                </div>
              </div>

              {compra.observacoes && (
                <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
                  <p className="text-xs text-muted-foreground mb-1">Observações</p>
                  {compra.observacoes}
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            {podeReceber && (
              <>
                <Button
                  variant="outline"
                  className="gap-1.5"
                  onClick={handleCancelar}
                  disabled={updateStatus.isPending}
                >
                  <XCircle className="h-4 w-4" />
                  Cancelar compra
                </Button>
                <Button className="gap-1.5" onClick={() => setReceberOpen(true)}>
                  <PackageCheck className="h-4 w-4" />
                  Receber itens
                </Button>
              </>
            )}
            {compra?.status === "recebida" && (
              <div className="flex w-full items-center gap-2 text-sm text-success">
                <CheckCircle2 className="h-4 w-4" />
                Compra recebida e estoque atualizado.
              </div>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReceberCompraDialog
        open={receberOpen}
        onOpenChange={setReceberOpen}
        compraId={compraId}
      />
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
