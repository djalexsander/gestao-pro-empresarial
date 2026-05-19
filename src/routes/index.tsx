import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataClient } from "@/integrations/data";
import {
  TrendingUp,
  ShoppingCart,
  Wallet,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Download,
  Filter,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboard } from "@/hooks/useDashboard";
import { ExportFormatDialog } from "@/components/shared/ExportFormatDialog";
import {
  exportarRelatorioCard,
  type ExportFormato,
} from "@/lib/export-relatorio-card";
import type { CsvColumn } from "@/lib/export-csv";
import { KpiDetailDialog, type KpiTipo } from "@/components/dashboard/KpiDetailDialog";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Gestão Pro" },
      { name: "description", content: "Visão geral de vendas, compras, financeiro e estoque." },
    ],
  }),
  component: DashboardPage,
});

const formatBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v ?? 0);

const chartTooltipStyle = {
  contentStyle: {
    backgroundColor: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    fontSize: "12px",
  },
  labelStyle: { color: "var(--foreground)", fontWeight: 600 },
};

function variacao(atual: number, anterior: number) {
  if (anterior <= 0) return atual > 0 ? 100 : 0;
  return ((atual - anterior) / anterior) * 100;
}

type DashboardPeriodo = "mes" | "30d" | "90d" | "6m";

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getRangeFromPeriodo(periodo: DashboardPeriodo) {
  const hoje = new Date();
  const fim = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 23, 59, 59, 999);

  if (periodo === "mes") {
    return {
      inicio: new Date(hoje.getFullYear(), hoje.getMonth(), 1, 0, 0, 0, 0),
      fim,
    };
  }

  if (periodo === "30d") {
    return {
      inicio: new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 29, 0, 0, 0, 0),
      fim,
    };
  }

  if (periodo === "90d") {
    return {
      inicio: new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 89, 0, 0, 0, 0),
      fim,
    };
  }

  return {
    inicio: new Date(hoje.getFullYear(), hoje.getMonth() - 5, 1, 0, 0, 0, 0),
    fim,
  };
}

function inRange(dateValue: string | null | undefined, inicio?: string, fim?: string) {
  if (!dateValue) return false;
  const value = new Date(dateValue);
  if (Number.isNaN(value.getTime())) return false;
  const start = inicio ? new Date(`${inicio}T00:00:00`) : null;
  const end = fim ? new Date(`${fim}T23:59:59`) : null;
  if (start && value < start) return false;
  if (end && value > end) return false;
  return true;
}

function DashboardPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useDashboard();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [periodo, setPeriodo] = useState<DashboardPeriodo>("mes");
  const defaultRange = useMemo(() => getRangeFromPeriodo("mes"), []);
  const [inicio, setInicio] = useState(formatDateInput(defaultRange.inicio));
  const [fim, setFim] = useState(formatDateInput(defaultRange.fim));
  const [kpiTipo, setKpiTipo] = useState<KpiTipo | null>(null);
  const [kpiOpen, setKpiOpen] = useState(false);

  function abrirKpi(tipo: KpiTipo) {
    setKpiTipo(tipo);
    setKpiOpen(true);
  }

  function aplicarPeriodo(value: DashboardPeriodo) {
    const range = getRangeFromPeriodo(value);
    setPeriodo(value);
    setInicio(formatDateInput(range.inicio));
    setFim(formatDateInput(range.fim));
  }

  function limparFiltros() {
    aplicarPeriodo("mes");
  }

  function formatPeriodoBR(d: string) {
    if (!d) return d;
    const [y, m, day] = d.split("-");
    return `${day}/${m}/${y}`;
  }

  async function exportarDashboard(formato: ExportFormato) {
    if (!data) return;
    setExporting(true);
    toast.loading("Gerando exportação...", { id: "export-dashboard" });
    try {
      const vendasRows = (data.ultimasVendas ?? []).filter((item) =>
        inRange(item.data, inicio, fim),
      );
      const comprasRows = (data.ultimasCompras ?? []).filter((item) =>
        inRange(item.data, inicio, fim),
      );

      type LinhaMov = {
        tipo: "Venda" | "Compra";
        numero: string;
        data: string;
        contraparte: string;
        valor: number;
        status: string;
      };

      const rows: LinhaMov[] = [
        ...vendasRows.map<LinhaMov>((v) => ({
          tipo: "Venda",
          numero: v.numero,
          data: v.data,
          contraparte: v.cliente,
          valor: Number(v.valor) || 0,
          status: v.status,
        })),
        ...comprasRows.map<LinhaMov>((c) => ({
          tipo: "Compra",
          numero: c.numero,
          data: c.data,
          contraparte: c.fornecedor,
          valor: Number(c.valor) || 0,
          status: c.status,
        })),
      ].sort((a, b) => (a.data < b.data ? 1 : -1));

      const columns: CsvColumn<LinhaMov>[] = [
        { header: "Tipo", accessor: (r) => r.tipo, type: "text" },
        { header: "Número", accessor: (r) => r.numero, type: "text" },
        { header: "Data", accessor: (r) => r.data, type: "datetime" },
        { header: "Cliente / Fornecedor", accessor: (r) => r.contraparte, type: "text" },
        { header: "Valor", accessor: (r) => r.valor, type: "currency" },
        { header: "Status", accessor: (r) => r.status, type: "text" },
      ];

      await exportarRelatorioCard(formato, {
        prefix: "dashboard",
        titulo: "Dashboard — Resumo geral",
        periodo: `${formatPeriodoBR(inicio)} a ${formatPeriodoBR(fim)}`,
        resumo: [
          { label: "Vendas do período", valor: formatBRL(data.vendasMes), tone: "success" },
          { label: "Compras do período", valor: formatBRL(data.comprasMes), tone: "info" },
          {
            label: "Lucro do período",
            valor: formatBRL(data.lucroMes),
            tone: data.lucroMes >= 0 ? "success" : "danger",
          },
          { label: "Contas a pagar", valor: formatBRL(data.contasPagar), tone: "warning" },
          { label: "Contas a receber", valor: formatBRL(data.contasReceber), tone: "success" },
          {
            label: "Estoque baixo",
            valor: String(data.estoqueBaixo),
            tone: data.estoqueBaixo > 0 ? "danger" : "muted",
          },
        ],
        rows,
        columns,
      });
      toast.success("Exportação concluída.", { id: "export-dashboard" });
      setExportOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao exportar.", {
        id: "export-dashboard",
      });
    } finally {
      setExporting(false);
    }
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Dashboard"
          description="Visão consolidada do desempenho da sua empresa."
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      </div>
    );
  }

  const varVendas = variacao(data.vendasMes, data.vendasMesAnterior);
  const varCompras = variacao(data.comprasMes, data.comprasMesAnterior);
  const ultimasVendas = (data.ultimasVendas ?? []).filter((item) => inRange(item.data, inicio, fim));
  const ultimasCompras = (data.ultimasCompras ?? []).filter((item) => inRange(item.data, inicio, fim));
  const totalDados =
    data.vendasMes +
    data.comprasMes +
    data.contasPagar +
    data.contasReceber +
    data.estoqueBaixo;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Visão consolidada do desempenho da sua empresa."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setSheetOpen(true)}
            >
              <Filter className="h-4 w-4" />
              Filtros
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => setExportOpen(true)}
              disabled={exporting}
            >
              <Download className="h-4 w-4" />
              Exportar
            </Button>
          </>
        }
      />

      {totalDados === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <TrendingUp className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-semibold">Sem dados ainda</h3>
            <p className="max-w-md text-sm text-muted-foreground">
              Os indicadores serão preenchidos automaticamente conforme você registrar
              vendas, compras e movimentações financeiras.
            </p>
            <div className="mt-2 flex gap-2">
              <Button onClick={() => navigate({ to: "/pdv" })}>Abrir PDV</Button>
              <Button variant="outline" onClick={() => navigate({ to: "/produtos" })}>
                Cadastrar produtos
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Vendas do mês"
          value={formatBRL(data.vendasMes)}
          change={Math.abs(Math.round(varVendas * 10) / 10)}
          trend={varVendas >= 0 ? "up" : "down"}
          hint="vs. mês anterior"
          icon={TrendingUp}
          iconTone="primary"
          onClick={() => abrirKpi("vendas")}
        />
        <StatCard
          label="Compras do mês"
          value={formatBRL(data.comprasMes)}
          change={Math.abs(Math.round(varCompras * 10) / 10)}
          trend={varCompras >= 0 ? "up" : "down"}
          hint="vs. mês anterior"
          icon={ShoppingCart}
          iconTone="info"
          onClick={() => abrirKpi("compras")}
        />
        <StatCard
          label="Lucro do mês"
          value={formatBRL(data.lucroMes)}
          hint={`margem ${data.margem.toFixed(1)}%`}
          icon={Wallet}
          iconTone={data.lucroMes >= 0 ? "success" : "danger"}
          onClick={() => abrirKpi("lucro")}
        />
        <StatCard
          label="Contas a pagar"
          value={formatBRL(data.contasPagar)}
          hint={`${data.qtdContasPagar} ${data.qtdContasPagar === 1 ? "título aberto" : "títulos abertos"}`}
          icon={ArrowUpFromLine}
          iconTone="warning"
          onClick={() => abrirKpi("contas-pagar")}
        />
        <StatCard
          label="Contas a receber"
          value={formatBRL(data.contasReceber)}
          hint={`${data.qtdContasReceber} ${data.qtdContasReceber === 1 ? "título aberto" : "títulos abertos"}`}
          icon={ArrowDownToLine}
          iconTone="success"
          onClick={() => abrirKpi("contas-receber")}
        />
        <StatCard
          label="Estoque baixo"
          value={String(data.estoqueBaixo)}
          hint={data.estoqueBaixo === 1 ? "produto crítico" : "produtos críticos"}
          icon={AlertTriangle}
          iconTone="danger"
          onClick={() => abrirKpi("estoque-baixo")}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Vendas por período</CardTitle>
              <p className="text-sm text-muted-foreground">Últimos 6 meses</p>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.vendasPorMes}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="month" stroke="var(--muted-foreground)" fontSize={12} />
                  <YAxis
                    stroke="var(--muted-foreground)"
                    fontSize={12}
                    tickFormatter={(v) => `R$ ${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip {...chartTooltipStyle} formatter={(v: number) => formatBRL(v)} />
                  <Line
                    type="monotone"
                    dataKey="vendas"
                    stroke="var(--chart-1)"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: "var(--chart-1)" }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Compras por período</CardTitle>
            <p className="text-sm text-muted-foreground">Últimos 6 meses</p>
          </CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.vendasPorMes}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="month" stroke="var(--muted-foreground)" fontSize={12} />
                  <YAxis
                    stroke="var(--muted-foreground)"
                    fontSize={12}
                    tickFormatter={(v) => `R$ ${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip {...chartTooltipStyle} formatter={(v: number) => formatBRL(v)} />
                  <Bar dataKey="compras" fill="var(--chart-2)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Fluxo financeiro</CardTitle>
          <p className="text-sm text-muted-foreground">Entradas vs. saídas — mês atual</p>
        </CardHeader>
        <CardContent>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.fluxoCaixa}>
                <defs>
                  <linearGradient id="entrada" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="saida" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-5)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--chart-5)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" stroke="var(--muted-foreground)" fontSize={12} />
                <YAxis
                  stroke="var(--muted-foreground)"
                  fontSize={12}
                  tickFormatter={(v) => `R$ ${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip {...chartTooltipStyle} formatter={(v: number) => formatBRL(v)} />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Area
                  type="monotone"
                  dataKey="entrada"
                  name="Entradas"
                  stroke="var(--chart-2)"
                  strokeWidth={2}
                  fill="url(#entrada)"
                />
                <Area
                  type="monotone"
                  dataKey="saida"
                  name="Saídas"
                  stroke="var(--chart-5)"
                  strokeWidth={2}
                  fill="url(#saida)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Tables */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Últimas vendas</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/vendas" })}>
              Ver todas
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {ultimasVendas.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                Nenhuma venda encontrada para o período selecionado.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pedido</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ultimasVendas.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {s.numero}
                      </TableCell>
                      <TableCell className="font-medium">{s.cliente}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatBRL(s.valor)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={s.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Últimas compras</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/compras" })}>
              Ver todas
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {ultimasCompras.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                Nenhuma compra encontrada para o período selecionado.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pedido</TableHead>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ultimasCompras.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {p.numero}
                      </TableCell>
                      <TableCell className="font-medium">{p.fornecedor}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatBRL(p.valor)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={p.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Filtros do dashboard</SheetTitle>
            <SheetDescription>
              Ajuste o período para filtrar as listas e a exportação do dashboard.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Período</Label>
              <Select value={periodo} onValueChange={(value) => aplicarPeriodo(value as DashboardPeriodo)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o período" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mes">Mês atual</SelectItem>
                  <SelectItem value="30d">Últimos 30 dias</SelectItem>
                  <SelectItem value="90d">Últimos 90 dias</SelectItem>
                  <SelectItem value="6m">Últimos 6 meses</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="dashboard-inicio">Data inicial</Label>
                <Input
                  id="dashboard-inicio"
                  type="date"
                  value={inicio}
                  onChange={(e) => setInicio(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dashboard-fim">Data final</Label>
                <Input
                  id="dashboard-fim"
                  type="date"
                  value={fim}
                  onChange={(e) => setFim(e.target.value)}
                />
              </div>
            </div>
          </div>

          <SheetFooter className="gap-2 sm:space-x-0">
            <Button variant="outline" className="gap-1.5" onClick={limparFiltros}>
              <RotateCcw className="h-4 w-4" />
              Limpar
            </Button>
            <Button onClick={() => setSheetOpen(false)}>Aplicar</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <ExportFormatDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        titulo="Dashboard — Resumo geral"
        loading={exporting}
        onChoose={(f) => exportarDashboard(f)}
      />

      <KpiDetailDialog
        open={kpiOpen}
        onOpenChange={setKpiOpen}
        tipo={kpiTipo}
        periodo={{
          inicio,
          fim,
          label: `${formatPeriodoBR(inicio)} a ${formatPeriodoBR(fim)}`,
        }}
      />
    </div>
  );
}
