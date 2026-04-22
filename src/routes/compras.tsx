import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Search, Eye, Trash2, ShoppingCart, Clock, PackageCheck, Ban } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { StatCard } from "@/components/shared/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCompras, useDeleteCompra, type CompraStatus } from "@/hooks/useCompras";
import { CompraDialog } from "@/components/compras/CompraDialog";
import { CompraDetailDialog } from "@/components/compras/CompraDetailDialog";

export const Route = createFileRoute("/compras")({
  head: () => ({
    meta: [
      { title: "Compras — Gestão Pro" },
      { name: "description", content: "Gestão de pedidos de compra e fornecedores." },
    ],
  }),
  component: PurchasesPage,
});

const fmtBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function PurchasesPage() {
  const { data: compras = [], isLoading } = useCompras();
  const deleteMut = useDeleteCompra();

  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState<CompraStatus | "todos">("todos");
  const [novaOpen, setNovaOpen] = useState(false);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [removendoId, setRemovendoId] = useState<string | null>(null);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return compras.filter((c) => {
      if (statusFiltro !== "todos" && c.status !== statusFiltro) return false;
      if (!q) return true;
      return (
        c.numero.toLowerCase().includes(q) ||
        c.fornecedor?.razao_social?.toLowerCase().includes(q) ||
        c.fornecedor?.nome_fantasia?.toLowerCase().includes(q)
      );
    });
  }, [compras, busca, statusFiltro]);

  const stats = useMemo(() => {
    const total = compras.length;
    const pendentes = compras.filter((c) => c.status === "pendente" || c.status === "rascunho" || c.status === "aprovada").length;
    const recebidas = compras.filter((c) => c.status === "recebida").length;
    const canceladas = compras.filter((c) => c.status === "cancelada").length;
    return { total, pendentes, recebidas, canceladas };
  }, [compras]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compras"
        description="Pedidos de compra e recebimento de mercadorias."
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setNovaOpen(true)}>
            <Plus className="h-4 w-4" />
            Nova compra
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total de pedidos" value={String(stats.total)} icon={ShoppingCart} />
        <StatCard label="Em aberto" value={String(stats.pendentes)} icon={Clock} iconTone="warning" />
        <StatCard label="Recebidas" value={String(stats.recebidas)} icon={PackageCheck} iconTone="success" />
        <StatCard label="Canceladas" value={String(stats.canceladas)} icon={Ban} iconTone="danger" />
      </div>

      <Card>
        <CardContent className="p-4 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar pedido ou fornecedor..."
              className="pl-9"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <Select value={statusFiltro} onValueChange={(v) => setStatusFiltro(v as CompraStatus | "todos")}>
            <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os status</SelectItem>
              <SelectItem value="rascunho">Rascunho</SelectItem>
              <SelectItem value="pendente">Pendente</SelectItem>
              <SelectItem value="aprovada">Aprovada</SelectItem>
              <SelectItem value="recebida">Recebida</SelectItem>
              <SelectItem value="cancelada">Cancelada</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pedido</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead>Emissão</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filtradas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                    Nenhuma compra encontrada.
                  </TableCell>
                </TableRow>
              )}
              {filtradas.map((c) => (
                <TableRow key={c.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setDetalheId(c.id)}>
                  <TableCell className="font-mono text-xs">{c.numero}</TableCell>
                  <TableCell className="font-medium">
                    {c.fornecedor
                      ? c.fornecedor.nome_fantasia || c.fornecedor.razao_social
                      : <span className="text-muted-foreground italic">—</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(c.data_emissao).toLocaleDateString("pt-BR")}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{fmtBRL(Number(c.total))}</TableCell>
                  <TableCell><StatusBadge status={c.status} /></TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDetalheId(c.id)}>
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      {c.status !== "recebida" && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                          onClick={() => setRemovendoId(c.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CompraDialog open={novaOpen} onOpenChange={setNovaOpen} />
      <CompraDetailDialog
        open={!!detalheId}
        onOpenChange={(o) => !o && setDetalheId(null)}
        compraId={detalheId}
      />

      <AlertDialog open={!!removendoId} onOpenChange={(o) => !o && setRemovendoId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir compra?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação remove o pedido e seus itens. Não é possível excluir compras já recebidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (removendoId) deleteMut.mutate(removendoId); setRemovendoId(null); }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
