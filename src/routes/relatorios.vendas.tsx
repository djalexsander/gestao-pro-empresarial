import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Download,
  Filter,
  Loader2,
  RotateCcw,
  Eye,
  ShoppingBag,
  Receipt,
  TrendingUp,
  Hash,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { useVendas, useVendaMetricasPeriodo } from "@/hooks/useVendas";
import { useClientesFull } from "@/hooks/useClientes";
import { useFuncionariosAtivos } from "@/hooks/useFuncionarios";
import { useCaixasHistorico } from "@/hooks/useCaixa";
import { DetalheVendaDialog } from "@/components/vendas/DetalheVendaDialog";
import { ModuloGate } from "@/components/saas/ModuloGate";
import { formatBRL } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { exportRowsToCSV, type CsvColumn } from "@/lib/export-csv";

export const Route = createFileRoute("/relatorios/vendas")({
  head: () => ({
    meta: [
      { title: "Relatório de Vendas — Gestão Pro" },
      {
        name: "description",
        content: "Análise detalhada de vendas por período, produto e operador.",
      },
    ],
  }),
  component: RelatorioVendasPage,
});

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

const STATUS_BADGE: Record<string, string> = {
  pago: "bg-success/15 text-success border-success/30",
  pendente: "bg-warning/15 text-warning border-warning/30",
  parcial: "bg-primary/15 text-primary border-primary/30",
  cancelado: "bg-destructive/15 text-destructive border-destructive/30",
};

type PeriodoPreset =
  | "hoje"
  | "ontem"
  | "7d"
  | "30d"
  | "mes"
  | "personalizado";

function calcRange(preset: PeriodoPreset): { inicio: string; fim: string } {
  const today = new Date();
  const fim = today.toISOString().slice(0, 10);
  let inicio = new Date(today);
  if (preset === "hoje") {
    // mantém
  } else if (preset === "ontem") {
    inicio.setDate(today.getDate() - 1);
    return {
      inicio: inicio.toISOString().slice(0, 10),
      fim: inicio.toISOString().slice(0, 10),
    };
  } else if (preset === "7d") {
    inicio.setDate(today.getDate() - 6);
  } else if (preset === "30d") {
    inicio.setDate(today.getDate() - 29);
  } else if (preset === "mes") {
    inicio = new Date(today.getFullYear(), today.getMonth(), 1);
  }
  return { inicio: inicio.toISOString().slice(0, 10), fim };
}

function previousRange(inicio: string, fim: string): { inicio: string; fim: string } {
  const di = new Date(inicio + "T00:00:00");
  const df = new Date(fim + "T00:00:00");
  const diasDiff = Math.max(1, Math.round((df.getTime() - di.getTime()) / 86_400_000) + 1);
  const novoFim = new Date(di);
  novoFim.setDate(di.getDate() - 1);
  const novoInicio = new Date(novoFim);
  novoInicio.setDate(novoFim.getDate() - (diasDiff - 1));
  return {
    inicio: novoInicio.toISOString().slice(0, 10),
    fim: novoFim.toISOString().slice(0, 10),
  };
}

function RelatorioVendasPage() {
  return (
    <ModuloGate chave="relatorios" titulo="Relatório de Vendas">
      <Conteudo />
    </ModuloGate>
  );
}

function Conteudo() {
  const navigate = useNavigate();
  const { data: vendas = [], isLoading } = useVendas();
  const { data: clientes = [] } = useClientesFull();
  const { data: funcionarios = [] } = useFuncionariosAtivos();
  const { data: caixasHistorico = [] } = useCaixasHistorico(200);

  const [preset, setPreset] = useState<PeriodoPreset>("30d");
  const [inicioCustom, setInicioCustom] = useState<string>("");
  const [fimCustom, setFimCustom] = useState<string>("");
  const [clienteFiltro, setClienteFiltro] = useState<string>("todos");
  const [operadorFiltro, setOperadorFiltro] = useState<string>("todos");
  const [formaFiltro, setFormaFiltro] = useState<string>("todos");
  const [caixaFiltro, setCaixaFiltro] = useState<string>("todos");
  const [aberturaFiltro, setAberturaFiltro] = useState<string>("todas");
  const [busca, setBusca] = useState("");
  const [page, setPage] = useState(1);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const PAGE_SIZE = 25;

  const { inicio, fim } = useMemo(() => {
    if (preset === "personalizado" && inicioCustom && fimCustom) {
      return { inicio: inicioCustom, fim: fimCustom };
    }
    return calcRange(preset);
  }, [preset, inicioCustom, fimCustom]);

  const { inicio: inicioPrev, fim: fimPrev } = useMemo(
    () => previousRange(inicio, fim),
    [inicio, fim],
  );

  const { data: metricas } = useVendaMetricasPeriodo(inicio, fim);
  const { data: metricasPrev } = useVendaMetricasPeriodo(inicioPrev, fimPrev);

  // Mapa de caixa_id → data_abertura (para filtro por data de abertura)
  const aberturasOptions = useMemo(() => {
    const set = new Map<string, string>(); // chave YYYY-MM-DD → label legível
    for (const c of caixasHistorico) {
      const dt = c.data_abertura ? c.data_abertura.slice(0, 10) : "";
      if (!dt) continue;
      if (!set.has(dt)) {
        set.set(dt, format(new Date(dt + "T00:00:00"), "dd/MM/yyyy"));
      }
    }
    return Array.from(set.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([value, label]) => ({ value, label }));
  }, [caixasHistorico]);

  // Conjunto de caixas que abriram na data selecionada
  const caixasNaAbertura = useMemo(() => {
    if (aberturaFiltro === "todas") return null;
    const ids = new Set<string>();
    for (const c of caixasHistorico) {
      if (c.data_abertura?.slice(0, 10) === aberturaFiltro) ids.add(c.id);
    }
    return ids;
  }, [aberturaFiltro, caixasHistorico]);

  // Reseta a página automaticamente quando qualquer filtro muda
  useEffect(() => {
    setPage(1);
  }, [
    preset,
    inicioCustom,
    fimCustom,
    clienteFiltro,
    operadorFiltro,
    formaFiltro,
    caixaFiltro,
    aberturaFiltro,
    busca,
  ]);

  const filtered = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return vendas.filter((v) => {
      if (v.data_emissao < inicio || v.data_emissao > fim) return false;
      if (clienteFiltro !== "todos") {
        if (clienteFiltro === "_sem") {
          if (v.cliente_id) return false;
        } else if (v.cliente_id !== clienteFiltro) return false;
      }
      if (formaFiltro !== "todos" && v.forma_pagamento !== formaFiltro) return false;
      if (operadorFiltro !== "todos" && v.operador_id !== operadorFiltro) return false;
      if (caixaFiltro !== "todos") {
        if (caixaFiltro === "_sem") {
          if (v.caixa_id) return false;
        } else if (v.caixa_id !== caixaFiltro) return false;
      }
      if (caixasNaAbertura) {
        if (!v.caixa_id || !caixasNaAbertura.has(v.caixa_id)) return false;
      }
      if (q) {
        const ok =
          v.numero.toLowerCase().includes(q) ||
          (v.cliente_nome ?? "").toLowerCase().includes(q);
        if (!ok) return false;
      }
      return true;
    });
  }, [
    vendas,
    busca,
    inicio,
    fim,
    clienteFiltro,
    formaFiltro,
    operadorFiltro,
    caixaFiltro,
    caixasNaAbertura,
  ]);

  // Dados do gráfico (linha por dia)
  const chartData = useMemo(() => {
    const map = new Map<string, number>();
    // gera todas as datas do range
    const di = new Date(inicio + "T00:00:00");
    const df = new Date(fim + "T00:00:00");
    for (let d = new Date(di); d <= df; d.setDate(d.getDate() + 1)) {
      map.set(d.toISOString().slice(0, 10), 0);
    }
    for (const v of filtered) {
      map.set(v.data_emissao, (map.get(v.data_emissao) ?? 0) + v.total);
    }
    return Array.from(map.entries()).map(([data, total]) => ({
      data: format(new Date(data + "T00:00:00"), "dd/MM"),
      total,
    }));
  }, [filtered, inicio, fim]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function pctDelta(atual?: number, anterior?: number): string | undefined {
    if (atual == null || anterior == null) return undefined;
    if (anterior === 0) return atual > 0 ? "+100%" : undefined;
    const delta = ((atual - anterior) / anterior) * 100;
    const sign = delta >= 0 ? "+" : "";
    return `${sign}${delta.toFixed(1)}% vs período anterior`;
  }

  function limparFiltros() {
    setPreset("30d");
    setInicioCustom("");
    setFimCustom("");
    setClienteFiltro("todos");
    setOperadorFiltro("todos");
    setFormaFiltro("todos");
    setCaixaFiltro("todos");
    setAberturaFiltro("todas");
    setBusca("");
    setPage(1);
  }

  async function handleExport() {
    if (filtered.length === 0) {
      toast.warning("Sem dados para exportar.");
      return;
    }
    setExporting(true);
    toast.loading("Gerando relatório...", { id: "export-vendas" });
    try {
      const columns: CsvColumn<typeof filtered[number]>[] = [
        { header: "Numero", accessor: (v) => v.numero, type: "text" },
        { header: "Data", accessor: (v) => v.data_emissao, type: "datetime" },
        { header: "Cliente", accessor: (v) => v.cliente_nome ?? "Consumidor", type: "text" },
        {
          header: "Forma pagamento",
          accessor: (v) =>
            v.forma_pagamento ? FORMA_LABEL[v.forma_pagamento] ?? v.forma_pagamento : "",
          type: "text",
        },
        { header: "Total", accessor: (v) => v.total, type: "currency" },
        { header: "Status", accessor: (v) => v.status, type: "text" },
        { header: "Pagamento", accessor: (v) => v.status_pagamento, type: "text" },
      ];
      exportRowsToCSV("vendas", filtered, columns);
      toast.success("Download iniciado", { id: "export-vendas" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha na exportação";
      toast.error(msg, { id: "export-vendas" });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relatório de Vendas"
        description="Análise detalhada de vendas por período, produto e operador."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => navigate({ to: "/relatorios" })}
            >
              <ArrowLeft className="h-4 w-4" />
              Voltar
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={exporting || isLoading}
              onClick={handleExport}
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Exportar CSV
            </Button>
          </div>
        }
      />

      {/* Filtros */}
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Período</label>
              <Select value={preset} onValueChange={(v) => setPreset(v as PeriodoPreset)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hoje">Hoje</SelectItem>
                  <SelectItem value="ontem">Ontem</SelectItem>
                  <SelectItem value="7d">Últimos 7 dias</SelectItem>
                  <SelectItem value="30d">Últimos 30 dias</SelectItem>
                  <SelectItem value="mes">Este mês</SelectItem>
                  <SelectItem value="personalizado">Personalizado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {preset === "personalizado" && (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Início</label>
                  <Input
                    type="date"
                    value={inicioCustom}
                    onChange={(e) => setInicioCustom(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Fim</label>
                  <Input
                    type="date"
                    value={fimCustom}
                    onChange={(e) => setFimCustom(e.target.value)}
                  />
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Cliente</label>
              <Select value={clienteFiltro} onValueChange={setClienteFiltro}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="_sem">Consumidor</SelectItem>
                  {clientes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Operador</label>
              <Select value={operadorFiltro} onValueChange={setOperadorFiltro}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {funcionarios.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Forma de pagamento
              </label>
              <Select value={formaFiltro} onValueChange={setFormaFiltro}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todas</SelectItem>
                  <SelectItem value="dinheiro">Dinheiro</SelectItem>
                  <SelectItem value="pix">PIX</SelectItem>
                  <SelectItem value="cartao_debito">Débito</SelectItem>
                  <SelectItem value="cartao_credito">Crédito</SelectItem>
                  <SelectItem value="boleto">Boleto</SelectItem>
                  <SelectItem value="transferencia">Transferência</SelectItem>
                  <SelectItem value="outro">Fiado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Caixa (sessão)</label>
              <Select value={caixaFiltro} onValueChange={setCaixaFiltro}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="_sem">Sem caixa vinculado</SelectItem>
                  {caixasHistorico.map((c) => {
                    const dt = c.data_abertura
                      ? format(new Date(c.data_abertura), "dd/MM HH:mm")
                      : "—";
                    const statusLbl = c.status === "aberto" ? " • aberto" : "";
                    return (
                      <SelectItem key={c.id} value={c.id}>
                        {dt}
                        {statusLbl}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Data de abertura
              </label>
              <Select value={aberturaFiltro} onValueChange={setAberturaFiltro}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {aberturasOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Buscar</label>
              <Input
                placeholder="Nº da venda ou cliente..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" className="gap-1.5" onClick={() => setPage(1)}>
              <Filter className="h-3.5 w-3.5" />
              Aplicar filtros
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={limparFiltros}>
              <RotateCcw className="h-3.5 w-3.5" />
              Limpar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Métricas */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total vendido"
          value={formatBRL(metricas?.total_vendido ?? 0)}
          hint={pctDelta(metricas?.total_vendido, metricasPrev?.total_vendido)}
          icon={Receipt}
          iconTone="success"
        />
        <StatCard
          label="Quantidade de vendas"
          value={(metricas?.qtd_vendas ?? 0).toString()}
          hint={pctDelta(metricas?.qtd_vendas, metricasPrev?.qtd_vendas)}
          icon={ShoppingBag}
          iconTone="primary"
        />
        <StatCard
          label="Ticket médio"
          value={formatBRL(metricas?.ticket_medio ?? 0)}
          hint={pctDelta(metricas?.ticket_medio, metricasPrev?.ticket_medio)}
          icon={TrendingUp}
          iconTone="info"
        />
        <StatCard
          label="Vendas exibidas"
          value={filtered.length.toString()}
          hint={`${formatBRL(filtered.reduce((a, v) => a + v.total, 0))} no filtro`}
          icon={Hash}
          iconTone="warning"
        />
      </div>

      {/* Gráfico */}
      <Card>
        <CardContent className="p-4">
          <h3 className="mb-3 text-sm font-semibold">Evolução diária</h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="data" tick={{ fontSize: 12 }} />
                <YAxis
                  tick={{ fontSize: 12 }}
                  tickFormatter={(v) =>
                    new Intl.NumberFormat("pt-BR", {
                      notation: "compact",
                      maximumFractionDigits: 1,
                    }).format(v as number)
                  }
                />
                <Tooltip
                  formatter={(value: number) => [formatBRL(value), "Vendido"]}
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="total"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Tabela */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : pageRows.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-1 text-center text-muted-foreground">
              <ShoppingBag className="h-8 w-8 opacity-40" />
              <p className="font-medium">Nenhuma venda encontrada</p>
              <p className="text-sm">Ajuste os filtros para ver mais resultados.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nº</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Forma</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-16 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((v) => {
                  const cancelada = v.status === "cancelada";
                  return (
                    <TableRow key={v.id} className={cn(cancelada && "opacity-60")}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {v.numero}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(v.data_emissao + "T00:00:00").toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell className="font-medium">
                        {v.cliente_nome ?? (
                          <span className="text-muted-foreground">Consumidor</span>
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
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setDetalheId(v.id)}
                          title="Ver detalhes"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Paginação */}
      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <p>
            Página {page} de {totalPages} — {filtered.length} resultados
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page === totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}

      <DetalheVendaDialog
        open={detalheId !== null}
        onOpenChange={(o) => !o && setDetalheId(null)}
        vendaId={detalheId}
      />
    </div>
  );
}
