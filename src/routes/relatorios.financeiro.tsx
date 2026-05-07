import { dataClient } from "@/integrations/data";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowDownRight,
  ArrowUpRight,
  Download,
  Loader2,
  PiggyBank,
  Wallet,
  Filter,
  RotateCcw,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ModuloGate } from "@/components/saas/ModuloGate";
import { formatBRL } from "@/lib/mock-data";
import { exportRowsToCSV, type CsvColumn } from "@/lib/export-csv";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/relatorios/financeiro")({
  head: () => ({
    meta: [
      { title: "Relatório Financeiro — Gestão Pro" },
      {
        name: "description",
        content: "Controle completo de receitas e despesas.",
      },
    ],
  }),
  component: () => (
    <ModuloGate chave="relatorios" titulo="Relatório Financeiro">
      <Conteudo />
    </ModuloGate>
  ),
});

type PeriodoPreset = "7d" | "30d" | "mes" | "ano" | "personalizado";
type TipoFiltro = "todos" | "receita" | "despesa";
type StatusFiltro = "todos" | "pago" | "pendente" | "vencido";

interface Lancamento {
  id: string;
  descricao: string;
  tipo: "receita" | "despesa";
  valor: number;
  valor_pago: number;
  data_emissao: string;
  data_vencimento: string;
  data_pagamento: string | null;
  status: "pago" | "pendente" | "atrasado" | "cancelado";
  forma_pagamento: string | null;
  categoria_id: string | null;
  categoria_nome: string | null;
  cliente_id: string | null;
  cliente_nome: string | null;
  fornecedor_id: string | null;
  fornecedor_nome: string | null;
}

interface Categoria {
  id: string;
  nome: string;
  tipo: "receita" | "despesa";
}

const PIE_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--primary))",
  "hsl(var(--info))",
  "hsl(var(--warning))",
];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function calcRange(p: PeriodoPreset, customIni: string, customFim: string): {
  inicio: string;
  fim: string;
} {
  const today = new Date();
  if (p === "personalizado") {
    return {
      inicio: customIni || isoDate(new Date(today.getFullYear(), today.getMonth(), 1)),
      fim: customFim || isoDate(today),
    };
  }
  const fim = isoDate(today);
  let inicio = new Date(today);
  if (p === "7d") inicio.setDate(today.getDate() - 6);
  else if (p === "30d") inicio.setDate(today.getDate() - 29);
  else if (p === "mes") inicio = new Date(today.getFullYear(), today.getMonth(), 1);
  else inicio = new Date(today.getFullYear(), 0, 1);
  return { inicio: isoDate(inicio), fim };
}

/** Status visual derivado: vencido = pendente com vencimento < hoje. */
function statusVisual(l: Lancamento): "pago" | "pendente" | "vencido" | "cancelado" {
  if (l.status === "pago") return "pago";
  if (l.status === "cancelado") return "cancelado";
  if (l.status === "atrasado") return "vencido";
  // pendente
  const hoje = isoDate(new Date());
  if (l.data_vencimento < hoje) return "vencido";
  return "pendente";
}

function statusBadgeClass(s: string): string {
  switch (s) {
    case "pago":
      return "bg-success/15 text-success border-success/30";
    case "pendente":
      return "bg-warning/15 text-warning-foreground border-warning/30";
    case "vencido":
      return "bg-destructive/15 text-destructive border-destructive/30";
    case "cancelado":
      return "bg-muted text-muted-foreground border-border";
    default:
      return "";
  }
}

function Conteudo() {
  const navigate = useNavigate();

  // ---- Filtros ----
  const [periodo, setPeriodo] = useState<PeriodoPreset>("mes");
  const [customIni, setCustomIni] = useState("");
  const [customFim, setCustomFim] = useState("");
  const [tipoFiltro, setTipoFiltro] = useState<TipoFiltro>("todos");
  const [categoriaFiltro, setCategoriaFiltro] = useState<string>("todas");
  const [statusFiltro, setStatusFiltro] = useState<StatusFiltro>("todos");

  // Filtros aplicados (separados para botão "Aplicar")
  const [aplicado, setAplicado] = useState({
    periodo,
    customIni,
    customFim,
  });

  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [rows, setRows] = useState<Lancamento[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [saldoAcumulado, setSaldoAcumulado] = useState<number>(0);

  // Carrega categorias uma vez
  useEffect(() => {
    (async () => {
      try {
        const data = await dataClient.relatorios.categoriasFinanceiras();
        setCategorias(data as Categoria[]);
      } catch {
        setCategorias([]);
      }
    })();
  }, []);

  // Carrega lançamentos do período
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { inicio, fim } = calcRange(
        aplicado.periodo,
        aplicado.customIni,
        aplicado.customFim,
      );

      try {
        const data = await dataClient.relatorios.lancamentosFinanceiroPeriodo({ inicio, fim });
        if (cancelled) return;
        setRows(data as Lancamento[]);
      } catch (e) {
        if (cancelled) return;
        toast.error(e instanceof Error ? e.message : "Falha ao carregar");
        setRows([]);
      }

      try {
        const { recebido, pago } = await dataClient.relatorios.saldoAcumuladoFinanceiro();
        if (!cancelled) setSaldoAcumulado(recebido - pago);
      } catch {
        if (!cancelled) setSaldoAcumulado(0);
      }

      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [aplicado]);

  // Filtros aplicados client-side (tipo / categoria / status)
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (tipoFiltro !== "todos" && r.tipo !== tipoFiltro) return false;
      if (categoriaFiltro !== "todas" && r.categoria_id !== categoriaFiltro)
        return false;
      if (statusFiltro !== "todos") {
        const sv = statusVisual(r);
        if (sv !== statusFiltro) return false;
      }
      return true;
    });
  }, [rows, tipoFiltro, categoriaFiltro, statusFiltro]);

  // ---- Cards principais ----
  const totais = useMemo(() => {
    let entradas = 0;
    let saidas = 0;
    for (const r of filteredRows) {
      const valor = r.valor_pago || r.valor;
      if (r.tipo === "receita") entradas += valor;
      else if (r.tipo === "despesa") saidas += valor;
    }
    return { entradas, saidas, lucro: entradas - saidas };
  }, [filteredRows]);

  // ---- Gráfico barras: entradas vs saídas por dia/mês ----
  const barData = useMemo(() => {
    // agrupa por dia (YYYY-MM-DD)
    const map = new Map<string, { dia: string; entradas: number; saidas: number }>();
    for (const r of filteredRows) {
      const key = r.data_vencimento;
      const cur = map.get(key) ?? { dia: key, entradas: 0, saidas: 0 };
      const valor = r.valor_pago || r.valor;
      if (r.tipo === "receita") cur.entradas += valor;
      else if (r.tipo === "despesa") cur.saidas += valor;
      map.set(key, cur);
    }
    return Array.from(map.values())
      .sort((a, b) => a.dia.localeCompare(b.dia))
      .map((d) => ({
        ...d,
        label: new Date(d.dia + "T00:00:00").toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
        }),
      }));
  }, [filteredRows]);

  // ---- Gráfico pizza: categorias de despesas ----
  const pieData = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filteredRows) {
      if (r.tipo !== "despesa") continue;
      const nome = r.categoria_nome ?? "Sem categoria";
      map.set(nome, (map.get(nome) ?? 0) + (r.valor_pago || r.valor));
    }
    return Array.from(map.entries())
      .map(([nome, valor]) => ({ nome, valor }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 8);
  }, [filteredRows]);

  // ---- Contas a receber / pagar (todas pendentes/vencidas, não filtradas por status) ----
  const contasReceber = useMemo(
    () =>
      filteredRows
        .filter((r) => r.tipo === "receita" && statusVisual(r) !== "pago")
        .sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento)),
    [filteredRows],
  );
  const contasPagar = useMemo(
    () =>
      filteredRows
        .filter((r) => r.tipo === "despesa" && statusVisual(r) !== "pago")
        .sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento)),
    [filteredRows],
  );

  // ---- Categorias do select (filtra pelo tipo selecionado) ----
  const categoriasSelecionaveis = useMemo(() => {
    if (tipoFiltro === "todos") return categorias;
    return categorias.filter((c) => c.tipo === tipoFiltro);
  }, [categorias, tipoFiltro]);

  function aplicarFiltros() {
    setAplicado({ periodo, customIni, customFim });
  }

  function limparFiltros() {
    setPeriodo("mes");
    setCustomIni("");
    setCustomFim("");
    setTipoFiltro("todos");
    setCategoriaFiltro("todas");
    setStatusFiltro("todos");
    setAplicado({ periodo: "mes", customIni: "", customFim: "" });
  }

  async function handleExport() {
    if (filteredRows.length === 0) {
      toast.warning("Sem dados para exportar.");
      return;
    }
    setExporting(true);
    toast.loading("Gerando relatório...", { id: "export-financeiro" });
    try {
      const columns: CsvColumn<Lancamento>[] = [
        { header: "Data vencimento", accessor: (r) => r.data_vencimento, type: "date" },
        { header: "Data pagamento", accessor: (r) => r.data_pagamento ?? "", type: "date" },
        { header: "Tipo", accessor: (r) => r.tipo, type: "text" },
        { header: "Categoria", accessor: (r) => r.categoria_nome ?? "", type: "text" },
        { header: "Descricao", accessor: (r) => r.descricao, type: "text" },
        {
          header: "Cliente/Fornecedor",
          accessor: (r) => r.cliente_nome ?? r.fornecedor_nome ?? "",
          type: "text",
        },
        { header: "Valor", accessor: (r) => r.valor, type: "currency" },
        { header: "Valor pago", accessor: (r) => r.valor_pago, type: "currency" },
        { header: "Forma pagamento", accessor: (r) => r.forma_pagamento ?? "", type: "text" },
        { header: "Status", accessor: (r) => statusVisual(r), type: "text" },
      ];
      exportRowsToCSV("financeiro", filteredRows, columns);
      toast.success("Download iniciado", { id: "export-financeiro" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao exportar", {
        id: "export-financeiro",
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relatório Financeiro"
        description="Controle completo de receitas e despesas."
        actions={
          <div className="flex gap-2">
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
              disabled={exporting}
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

      {/* ---- Filtros ---- */}
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
            <div>
              <Label className="text-xs">Período</Label>
              <Select
                value={periodo}
                onValueChange={(v) => setPeriodo(v as PeriodoPreset)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">Últimos 7 dias</SelectItem>
                  <SelectItem value="30d">Últimos 30 dias</SelectItem>
                  <SelectItem value="mes">Este mês</SelectItem>
                  <SelectItem value="ano">Este ano</SelectItem>
                  <SelectItem value="personalizado">Personalizado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {periodo === "personalizado" && (
              <>
                <div>
                  <Label className="text-xs">De</Label>
                  <Input
                    type="date"
                    className="mt-1"
                    value={customIni}
                    onChange={(e) => setCustomIni(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs">Até</Label>
                  <Input
                    type="date"
                    className="mt-1"
                    value={customFim}
                    onChange={(e) => setCustomFim(e.target.value)}
                  />
                </div>
              </>
            )}

            <div>
              <Label className="text-xs">Tipo</Label>
              <Select
                value={tipoFiltro}
                onValueChange={(v) => {
                  setTipoFiltro(v as TipoFiltro);
                  setCategoriaFiltro("todas");
                }}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="receita">Entrada</SelectItem>
                  <SelectItem value="despesa">Saída</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Categoria</Label>
              <Select value={categoriaFiltro} onValueChange={setCategoriaFiltro}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {categoriasSelecionaveis.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Status</Label>
              <Select
                value={statusFiltro}
                onValueChange={(v) => setStatusFiltro(v as StatusFiltro)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="pago">Pago</SelectItem>
                  <SelectItem value="pendente">Pendente</SelectItem>
                  <SelectItem value="vencido">Vencido</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="gap-1.5" onClick={aplicarFiltros}>
              <Filter className="h-4 w-4" />
              Aplicar filtros
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={limparFiltros}
            >
              <RotateCcw className="h-4 w-4" />
              Limpar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ---- Cards principais ---- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total de entradas"
          value={formatBRL(totais.entradas)}
          icon={ArrowUpRight}
          iconTone="success"
        />
        <StatCard
          label="Total de saídas"
          value={formatBRL(totais.saidas)}
          icon={ArrowDownRight}
          iconTone="warning"
        />
        <StatCard
          label="Lucro líquido"
          value={formatBRL(totais.lucro)}
          icon={TrendingUp}
          iconTone={totais.lucro >= 0 ? "success" : "danger"}
          hint="Período selecionado"
        />
        <StatCard
          label="Saldo acumulado"
          value={formatBRL(saldoAcumulado)}
          icon={PiggyBank}
          iconTone={saldoAcumulado >= 0 ? "primary" : "danger"}
          hint="Histórico total"
        />
      </div>

      {/* ---- Gráficos ---- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Entradas vs Saídas</CardTitle>
          </CardHeader>
          <CardContent className="pl-2">
            {loading ? (
              <div className="flex h-[260px] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : barData.length === 0 ? (
              <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
                Sem dados no período
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={barData}>
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) =>
                      v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`
                    }
                  />
                  <RTooltip
                    formatter={(v: number) => formatBRL(v)}
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid hsl(var(--border))",
                      background: "hsl(var(--card))",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    dataKey="entradas"
                    name="Entradas"
                    fill="hsl(var(--success))"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="saidas"
                    name="Saídas"
                    fill="hsl(var(--destructive))"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Despesas por categoria</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-[260px] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : pieData.length === 0 ? (
              <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
                Sem despesas no período
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <RTooltip
                    formatter={(v: number) => formatBRL(v)}
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid hsl(var(--border))",
                      background: "hsl(var(--card))",
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 12 }}
                    layout="vertical"
                    align="right"
                    verticalAlign="middle"
                  />
                  <Pie
                    data={pieData}
                    dataKey="valor"
                    nameKey="nome"
                    cx="40%"
                    cy="50%"
                    outerRadius={90}
                    innerRadius={45}
                    paddingAngle={2}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---- Tabela financeira ---- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Lançamentos
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              ({filteredRows.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-1 text-muted-foreground">
              <Wallet className="h-8 w-8 opacity-40" />
              <p className="font-medium">Sem lançamentos no período</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Cliente/Fornecedor</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((r) => {
                  const sv = statusVisual(r);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="text-muted-foreground">
                        {new Date(
                          r.data_vencimento + "T00:00:00",
                        ).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "capitalize",
                            r.tipo === "receita"
                              ? "bg-success/15 text-success border-success/30"
                              : "bg-destructive/15 text-destructive border-destructive/30",
                          )}
                        >
                          {r.tipo === "receita" ? "Entrada" : "Saída"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.categoria_nome ?? "—"}
                      </TableCell>
                      <TableCell className="font-medium">{r.descricao}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.cliente_nome ?? r.fornecedor_nome ?? "—"}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-medium tabular-nums",
                          r.tipo === "receita" ? "text-success" : "text-destructive",
                        )}
                      >
                        {formatBRL(r.valor_pago || r.valor)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn("capitalize", statusBadgeClass(sv))}
                        >
                          {sv}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ---- Fluxo de contas (a receber / a pagar) ---- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Fluxo de contas</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Tabs defaultValue="receber" className="w-full">
            <div className="px-4 pt-2">
              <TabsList>
                <TabsTrigger value="receber">
                  A receber
                  <Badge
                    variant="outline"
                    className="ml-2 bg-success/15 text-success border-success/30"
                  >
                    {contasReceber.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="pagar">
                  A pagar
                  <Badge
                    variant="outline"
                    className="ml-2 bg-destructive/15 text-destructive border-destructive/30"
                  >
                    {contasPagar.length}
                  </Badge>
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="receber" className="m-0">
              <ContasTabela rows={contasReceber} pessoaLabel="Cliente" />
            </TabsContent>
            <TabsContent value="pagar" className="m-0">
              <ContasTabela rows={contasPagar} pessoaLabel="Fornecedor" />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function ContasTabela({
  rows,
  pessoaLabel,
}: {
  rows: Lancamento[];
  pessoaLabel: "Cliente" | "Fornecedor";
}) {
  if (rows.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        Nenhum lançamento em aberto
      </div>
    );
  }
  const total = rows.reduce((a, r) => a + (r.valor - r.valor_pago), 0);
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Vencimento</TableHead>
            <TableHead>Descrição</TableHead>
            <TableHead>{pessoaLabel}</TableHead>
            <TableHead className="text-right">Valor</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const sv = statusVisual(r);
            const restante = r.valor - r.valor_pago;
            return (
              <TableRow key={r.id}>
                <TableCell className="text-muted-foreground">
                  {new Date(
                    r.data_vencimento + "T00:00:00",
                  ).toLocaleDateString("pt-BR")}
                </TableCell>
                <TableCell className="font-medium">{r.descricao}</TableCell>
                <TableCell className="text-muted-foreground">
                  {pessoaLabel === "Cliente"
                    ? (r.cliente_nome ?? "—")
                    : (r.fornecedor_nome ?? "—")}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatBRL(restante)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn("capitalize", statusBadgeClass(sv))}
                  >
                    {sv}
                  </Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-4 py-3 text-sm">
        <span className="text-muted-foreground">Total em aberto:</span>
        <span className="font-semibold tabular-nums">{formatBRL(total)}</span>
      </div>
    </>
  );
}
