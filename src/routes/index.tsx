import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  TrendingUp,
  ShoppingCart,
  Wallet,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Download,
  Filter,
} from "lucide-react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboard } from "@/hooks/useDashboard";

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

function DashboardPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useDashboard();

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
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter className="h-4 w-4" />
              Filtros
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => navigate({ to: "/relatorios" })}
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Vendas do mês"
          value={formatBRL(data.vendasMes)}
          change={Math.abs(Math.round(varVendas * 10) / 10)}
          trend={varVendas >= 0 ? "up" : "down"}
          hint="vs. mês anterior"
          icon={TrendingUp}
          iconTone="primary"
        />
        <StatCard
          label="Compras do mês"
          value={formatBRL(data.comprasMes)}
          change={Math.abs(Math.round(varCompras * 10) / 10)}
          trend={varCompras >= 0 ? "up" : "down"}
          hint="vs. mês anterior"
          icon={ShoppingCart}
          iconTone="info"
        />
        <StatCard
          label="Lucro do mês"
          value={formatBRL(data.lucroMes)}
          hint={`margem ${data.margem.toFixed(1)}%`}
          icon={Wallet}
          iconTone={data.lucroMes >= 0 ? "success" : "danger"}
        />
        <StatCard
          label="Contas a pagar"
          value={formatBRL(data.contasPagar)}
          hint={`${data.qtdContasPagar} ${data.qtdContasPagar === 1 ? "título aberto" : "títulos abertos"}`}
          icon={ArrowUpFromLine}
          iconTone="warning"
        />
        <StatCard
          label="Contas a receber"
          value={formatBRL(data.contasReceber)}
          hint={`${data.qtdContasReceber} ${data.qtdContasReceber === 1 ? "título aberto" : "títulos abertos"}`}
          icon={ArrowDownToLine}
          iconTone="success"
        />
        <StatCard
          label="Estoque baixo"
          value={String(data.estoqueBaixo)}
          hint={data.estoqueBaixo === 1 ? "produto crítico" : "produtos críticos"}
          icon={AlertTriangle}
          iconTone="danger"
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
            <div className="h-72">
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
            <div className="h-72">
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
          <div className="h-80">
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
            {data.ultimasVendas.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                Nenhuma venda registrada ainda.
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
                  {data.ultimasVendas.map((s) => (
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
            {data.ultimasCompras.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                Nenhuma compra registrada ainda.
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
                  {data.ultimasCompras.map((p) => (
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
    </div>
  );
}
