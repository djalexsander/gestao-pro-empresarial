import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Plus,
  Search,
  Eye,
  X,
  Trash2,
  Loader2,
  ShoppingBag,
  Receipt,
  TrendingUp,
  AlertCircle,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { CloudDependencyNotice } from "@/components/shared/CloudDependencyNotice";
import { StatCard } from "@/components/shared/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { formatBRL } from "@/lib/mock-data";
import {
  useVendaMetricasPeriodo,
  useVendas,
  useExcluirVendaCancelada,
  type VendaListItem,
} from "@/hooks/useVendas";
import { useClientesFull } from "@/hooks/useClientes";
import { CancelarVendaDialog } from "@/components/vendas/CancelarVendaDialog";
import { DetalheVendaDialog } from "@/components/vendas/DetalheVendaDialog";
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
  vencido: "bg-destructive/15 text-destructive border-destructive/30",
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

type Periodo = "hoje" | "7d" | "30d" | "mes" | "todos";

function rangeFromPeriodo(p: Periodo): { inicio: string; fim: string } {
  const today = new Date();
  const fim = today.toISOString().slice(0, 10);
  let inicioDate = new Date(today);
  if (p === "hoje") {
    // mantem
  } else if (p === "7d") {
    inicioDate.setDate(today.getDate() - 6);
  } else if (p === "30d") {
    inicioDate.setDate(today.getDate() - 29);
  } else if (p === "mes") {
    inicioDate = new Date(today.getFullYear(), today.getMonth(), 1);
  } else {
    inicioDate = new Date(2000, 0, 1);
  }
  return { inicio: inicioDate.toISOString().slice(0, 10), fim };
}

function SalesPage() {
  const navigate = useNavigate();
  const { data: vendas = [], isLoading } = useVendas();
  const { data: clientes = [] } = useClientesFull();
  const [query, setQuery] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>("hoje");
  const [statusPgto, setStatusPgto] = useState<string>("todos");
  const [forma, setForma] = useState<string>("todos");
  const [clienteFiltro, setClienteFiltro] = useState<string>("todos");
  const [cancelar, setCancelar] = useState<VendaListItem | null>(null);
  const [excluir, setExcluir] = useState<VendaListItem | null>(null);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const excluirMutation = useExcluirVendaCancelada();

  const { inicio, fim } = useMemo(() => rangeFromPeriodo(periodo), [periodo]);
  const { data: metricas } = useVendaMetricasPeriodo(inicio, fim);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vendas.filter((v) => {
      // Período
      if (periodo !== "todos") {
        if (v.data_emissao < inicio || v.data_emissao > fim) return false;
      }
      // Status pagto
      if (statusPgto !== "todos" && v.status_pagamento !== statusPgto) return false;
      // Forma
      if (forma !== "todos" && v.forma_pagamento !== forma) return false;
      // Cliente
      if (clienteFiltro !== "todos") {
        if (clienteFiltro === "_sem") {
          if (v.cliente_id) return false;
        } else if (v.cliente_id !== clienteFiltro) {
          return false;
        }
      }
      // Busca textual
      if (!q) return true;
      return (
        v.numero.toLowerCase().includes(q) ||
        (v.cliente_nome ?? "").toLowerCase().includes(q)
      );
    });
  }, [vendas, query, periodo, inicio, fim, statusPgto, forma, clienteFiltro]);

  const periodoLabel = useMemo(() => {
    if (periodo === "hoje") return "hoje";
    if (periodo === "7d") return "últimos 7 dias";
    if (periodo === "30d") return "últimos 30 dias";
    if (periodo === "mes") return "este mês";
    return "todo período";
  }, [periodo]);

  return (
    <div className="space-y-6">
      <CloudDependencyNotice title="Lista de vendas vem da nuvem" message="A listagem de vendas ainda lê da nuvem. Vendas registradas neste terminal e ainda não sincronizadas podem aparecer com atraso. Após a sincronização a lista é atualizada." />
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

      {/* Métricas do período */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={`Vendas (${periodoLabel})`}
          value={(metricas?.qtd_vendas ?? 0).toString()}
          hint={
            metricas?.qtd_canceladas
              ? `${metricas.qtd_canceladas} canceladas`
              : undefined
          }
          icon={ShoppingBag}
          iconTone="primary"
        />
        <StatCard
          label="Faturamento"
          value={formatBRL(metricas?.total_vendido ?? 0)}
          icon={Receipt}
          iconTone="success"
        />
        <StatCard
          label="Ticket médio"
          value={formatBRL(metricas?.ticket_medio ?? 0)}
          icon={TrendingUp}
          iconTone="info"
        />
        <StatCard
          label="A receber"
          value={formatBRL(metricas?.valor_pendente ?? 0)}
          hint={
            metricas?.qtd_pendentes
              ? `${metricas.qtd_pendentes} pendentes`
              : "tudo recebido"
          }
          icon={AlertCircle}
          iconTone="warning"
        />
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative lg:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por número ou cliente..."
              className="pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Select value={periodo} onValueChange={(v) => setPeriodo(v as Periodo)}>
            <SelectTrigger>
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hoje">Hoje</SelectItem>
              <SelectItem value="7d">Últimos 7 dias</SelectItem>
              <SelectItem value="30d">Últimos 30 dias</SelectItem>
              <SelectItem value="mes">Este mês</SelectItem>
              <SelectItem value="todos">Todo período</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusPgto} onValueChange={setStatusPgto}>
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos status</SelectItem>
              <SelectItem value="pago">Pago</SelectItem>
              <SelectItem value="pendente">Pendente</SelectItem>
              <SelectItem value="parcial">Parcial</SelectItem>
              <SelectItem value="cancelado">Cancelado</SelectItem>
            </SelectContent>
          </Select>
          <Select value={forma} onValueChange={setForma}>
            <SelectTrigger>
              <SelectValue placeholder="Forma pgto" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas formas</SelectItem>
              <SelectItem value="dinheiro">Dinheiro</SelectItem>
              <SelectItem value="pix">PIX</SelectItem>
              <SelectItem value="cartao_debito">Débito</SelectItem>
              <SelectItem value="cartao_credito">Crédito</SelectItem>
              <SelectItem value="boleto">Boleto</SelectItem>
              <SelectItem value="transferencia">Transferência</SelectItem>
              <SelectItem value="outro">Fiado</SelectItem>
            </SelectContent>
          </Select>
          <Select value={clienteFiltro} onValueChange={setClienteFiltro}>
            <SelectTrigger className="lg:col-span-2">
              <SelectValue placeholder="Cliente" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os clientes</SelectItem>
              <SelectItem value="_sem">Sem cliente (Consumidor)</SelectItem>
              {clientes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
                      <TableCell className="font-mono text-xs">
                        <button
                          type="button"
                          onClick={() => setDetalheId(v.id)}
                          className="rounded-sm text-muted-foreground underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:text-primary focus-visible:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          title="Ver detalhes da venda"
                        >
                          {v.numero}
                        </button>
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
                          {cancelada && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => setExcluir(v)}
                              title="Excluir venda cancelada definitivamente"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
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
          setCancelar(null);
        }}
      />

      <DetalheVendaDialog
        open={detalheId !== null}
        onOpenChange={(o) => !o && setDetalheId(null)}
        vendaId={detalheId}
      />

      <AlertDialog
        open={excluir !== null}
        onOpenChange={(o) => !o && setExcluir(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Excluir venda {excluir?.numero}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é <strong>permanente</strong> e remove a venda do
              histórico. O estorno de estoque e os lançamentos financeiros já
              cancelados serão preservados (apenas desvinculados). Use somente
              para limpeza de registros indesejados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluirMutation.isPending}>
              Voltar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={excluirMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (e) => {
                e.preventDefault();
                if (!excluir) return;
                try {
                  await excluirMutation.mutateAsync(excluir.id);
                  setExcluir(null);
                } catch {
                  /* toast já mostrado pelo hook */
                }
              }}
            >
              {excluirMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Excluindo...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Excluir definitivamente
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
