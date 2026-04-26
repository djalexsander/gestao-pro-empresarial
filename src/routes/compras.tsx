import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Plus,
  Search,
  Eye,
  Trash2,
  ShoppingCart,
  Clock,
  PackageCheck,
  Ban,
  CircleDollarSign,
  X,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
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
import { useFornecedores } from "@/hooks/useFornecedores";
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

const STATUS_EM_ABERTO: CompraStatus[] = ["rascunho", "pendente", "aprovada", "recebida_parcial"];

export function PurchasesPage() {
  const { data: compras = [], isLoading } = useCompras();
  const { data: fornecedores = [] } = useFornecedores();
  const deleteMut = useDeleteCompra();

  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState<CompraStatus | "todos">("todos");
  const [fornecedorFiltro, setFornecedorFiltro] = useState<string>("todos");
  const [dataIni, setDataIni] = useState<string>("");
  const [dataFim, setDataFim] = useState<string>("");
  const [novaOpen, setNovaOpen] = useState(false);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [removendoId, setRemovendoId] = useState<string | null>(null);
  const [diasAbertos, setDiasAbertos] = useState<Record<string, boolean>>({});

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return compras.filter((c) => {
      if (statusFiltro !== "todos" && c.status !== statusFiltro) return false;
      if (fornecedorFiltro !== "todos") {
        if (fornecedorFiltro === "sem" && c.fornecedor_id) return false;
        if (fornecedorFiltro !== "sem" && c.fornecedor_id !== fornecedorFiltro) return false;
      }
      if (dataIni && c.data_emissao < dataIni) return false;
      if (dataFim && c.data_emissao > dataFim) return false;
      if (!q) return true;
      return (
        c.numero.toLowerCase().includes(q) ||
        c.fornecedor?.razao_social?.toLowerCase().includes(q) ||
        c.fornecedor?.nome_fantasia?.toLowerCase().includes(q)
      );
    });
  }, [compras, busca, statusFiltro, fornecedorFiltro, dataIni, dataFim]);

  const stats = useMemo(() => {
    const total = filtradas.length;
    const emAberto = filtradas.filter((c) => STATUS_EM_ABERTO.includes(c.status)).length;
    const recebidas = filtradas.filter((c) => c.status === "recebida").length;
    const valorAberto = filtradas
      .filter((c) => STATUS_EM_ABERTO.includes(c.status))
      .reduce((acc, c) => acc + Number(c.total ?? 0), 0);
    return { total, emAberto, recebidas, valorAberto };
  }, [filtradas]);

  const gruposPorDia = useMemo(() => {
    const mapa = new Map<string, typeof filtradas>();
    for (const c of filtradas) {
      const dia = c.data_emissao.slice(0, 10);
      if (!mapa.has(dia)) mapa.set(dia, [] as typeof filtradas);
      mapa.get(dia)!.push(c);
    }
    return Array.from(mapa.entries())
      .map(([dia, list]) => ({
        dia,
        compras: list,
        total: list.reduce((s, c) => s + Number(c.total ?? 0), 0),
        qtd: list.length,
      }))
      .sort((a, b) => (a.dia < b.dia ? 1 : -1));
  }, [filtradas]);

  function toggleDia(dia: string) {
    setDiasAbertos((prev) => ({ ...prev, [dia]: !prev[dia] }));
  }

  function formatarDia(dia: string) {
    const d = new Date(dia + "T00:00:00");
    return d.toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  }

  const limparFiltros = () => {
    setBusca("");
    setStatusFiltro("todos");
    setFornecedorFiltro("todos");
    setDataIni("");
    setDataFim("");
  };

  const filtroAtivo =
    busca || statusFiltro !== "todos" || fornecedorFiltro !== "todos" || dataIni || dataFim;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compras"
        description="Pedidos de compra, recebimento parcial e atualização automática de estoque."
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setNovaOpen(true)}>
            <Plus className="h-4 w-4" />
            Nova compra
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total de pedidos" value={String(stats.total)} icon={ShoppingCart} />
        <StatCard label="Em aberto" value={String(stats.emAberto)} icon={Clock} iconTone="warning" />
        <StatCard label="Recebidas" value={String(stats.recebidas)} icon={PackageCheck} iconTone="success" />
        <StatCard
          label="Valor em aberto"
          value={fmtBRL(stats.valorAberto)}
          icon={CircleDollarSign}
          iconTone="warning"
        />
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar pedido ou fornecedor..."
                className="pl-9"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
            <Select
              value={statusFiltro}
              onValueChange={(v) => setStatusFiltro(v as CompraStatus | "todos")}
            >
              <SelectTrigger className="sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                <SelectItem value="rascunho">Rascunho</SelectItem>
                <SelectItem value="pendente">Pendente</SelectItem>
                <SelectItem value="aprovada">Aprovada</SelectItem>
                <SelectItem value="recebida_parcial">Recebida parcial</SelectItem>
                <SelectItem value="recebida">Recebida</SelectItem>
                <SelectItem value="cancelada">Cancelada</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Select value={fornecedorFiltro} onValueChange={setFornecedorFiltro}>
              <SelectTrigger>
                <SelectValue placeholder="Fornecedor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os fornecedores</SelectItem>
                <SelectItem value="sem">Sem fornecedor</SelectItem>
                {fornecedores.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.nome_fantasia || f.razao_social}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={dataIni}
              onChange={(e) => setDataIni(e.target.value)}
              placeholder="De"
            />
            <Input
              type="date"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
              placeholder="Até"
            />
            {filtroAtivo && (
              <Button variant="ghost" size="sm" onClick={limparFiltros} className="gap-1.5">
                <X className="h-3.5 w-3.5" /> Limpar filtros
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-10 text-center text-muted-foreground">
              Carregando...
            </div>
          ) : gruposPorDia.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              Nenhuma compra encontrada.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {gruposPorDia.map((grupo) => {
                const aberto = diasAbertos[grupo.dia] ?? false;
                return (
                  <div key={grupo.dia}>
                    <button
                      type="button"
                      onClick={() => toggleDia(grupo.dia)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                    >
                      <div className="flex items-center gap-2">
                        {aberto ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="text-sm font-medium capitalize text-foreground">
                          {formatarDia(grupo.dia)}
                        </span>
                        <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {grupo.qtd} {grupo.qtd === 1 ? "pedido" : "pedidos"}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Total{" "}
                        <span className="font-mono font-medium text-foreground tabular-nums">
                          {fmtBRL(grupo.total)}
                        </span>
                      </div>
                    </button>
                    {aberto && (
                      <div className="bg-muted/20 px-2 pb-3">
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
                            {grupo.compras.map((c) => (
                              <TableRow
                                key={c.id}
                                className="cursor-pointer hover:bg-muted/30"
                                onClick={() => setDetalheId(c.id)}
                              >
                                <TableCell className="font-mono text-xs">
                                  {c.numero}
                                </TableCell>
                                <TableCell className="font-medium">
                                  {c.fornecedor ? (
                                    c.fornecedor.nome_fantasia ||
                                    c.fornecedor.razao_social
                                  ) : (
                                    <span className="italic text-muted-foreground">
                                      —
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  {new Date(c.data_emissao).toLocaleDateString(
                                    "pt-BR",
                                  )}
                                </TableCell>
                                <TableCell className="text-right font-medium tabular-nums">
                                  {fmtBRL(Number(c.total))}
                                </TableCell>
                                <TableCell>
                                  <StatusBadge status={c.status} />
                                </TableCell>
                                <TableCell>
                                  <div
                                    className="flex items-center justify-end gap-1"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={() => setDetalheId(c.id)}
                                    >
                                      <Eye className="h-3.5 w-3.5" />
                                    </Button>
                                    {c.status !== "recebida" &&
                                      c.status !== "recebida_parcial" && (
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-8 w-8 text-destructive"
                                          onClick={() => setRemovendoId(c.id)}
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                      )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
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
              Esta ação remove o pedido e seus itens. Não é possível excluir compras já recebidas
              (totais ou parciais).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (removendoId) deleteMut.mutate(removendoId);
                setRemovendoId(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
