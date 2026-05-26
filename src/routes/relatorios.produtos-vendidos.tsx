import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Download,
  Loader2,
  Printer,
  Search,
  Eye,
  RotateCcw,
  Package,
  TrendingUp,
  DollarSign,
  Hash,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ModuloGate } from "@/components/saas/ModuloGate";
import { ExportFormatDialog } from "@/components/shared/ExportFormatDialog";
import {
  exportarRelatorioCard,
  type ExportFormato,
} from "@/lib/export-relatorio-card";
import { type CsvColumn } from "@/lib/export-csv";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useFuncionariosAtivos } from "@/hooks/useFuncionarios";
import { useCaixasHistorico } from "@/hooks/useCaixa";
import { formatBRL } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/relatorios/produtos-vendidos")({
  head: () => ({
    meta: [
      { title: "Produtos Vendidos — Gestão Pro" },
      {
        name: "description",
        content:
          "Relatório de produtos vendidos por período, com quantidade, faturamento, custo, lucro e margem.",
      },
    ],
  }),
  component: RelatorioProdutosVendidosPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-sm text-destructive">
      Erro ao carregar relatório: {error.message}
    </div>
  ),
  notFoundComponent: () => (
    <div className="p-6 text-sm text-muted-foreground">Relatório não encontrado.</div>
  ),
});

type PeriodoPreset =
  | "hoje"
  | "ontem"
  | "semana"
  | "mes"
  | "mes_anterior"
  | "personalizado";

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

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function calcRange(preset: PeriodoPreset): { inicio: string; fim: string } {
  const today = new Date();
  if (preset === "hoje") {
    const s = isoDate(today);
    return { inicio: s, fim: s };
  }
  if (preset === "ontem") {
    const d = new Date(today);
    d.setDate(today.getDate() - 1);
    const s = isoDate(d);
    return { inicio: s, fim: s };
  }
  if (preset === "semana") {
    const d = new Date(today);
    const diff = (d.getDay() + 6) % 7; // segunda como início
    d.setDate(d.getDate() - diff);
    return { inicio: isoDate(d), fim: isoDate(today) };
  }
  if (preset === "mes_anterior") {
    const ini = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const fim = new Date(today.getFullYear(), today.getMonth(), 0);
    return { inicio: isoDate(ini), fim: isoDate(fim) };
  }
  // mes (este mês)
  const ini = new Date(today.getFullYear(), today.getMonth(), 1);
  return { inicio: isoDate(ini), fim: isoDate(today) };
}

interface ItemVendaRow {
  item_id: string;
  venda_id: string;
  venda_numero: string;
  data_emissao: string;
  data_finalizacao: string | null;
  produto_id: string | null;
  produto_nome: string;
  sku: string | null;
  codigo_barras: string | null;
  quantidade: number;
  preco_unitario: number;
  desconto: number;
  total: number;
  custo_unitario: number;
  custo_total: number;
  lucro: number;
  margem: number;
  forma_pagamento: string | null;
  operador_id: string | null;
  caixa_id: string | null;
  terminal_id: string | null;
  cliente_nome: string | null;
  status_venda: string;
}

function useItensVendidos(
  inicio: string,
  fim: string,
  incluirCanceladas: boolean,
) {
  return useQuery({
    queryKey: ["relatorios", "produtos-vendidos", inicio, fim, incluirCanceladas],
    queryFn: async (): Promise<ItemVendaRow[]> => {
      let query = supabase
        .from("vendas")
        .select(
          `id, numero, data_emissao, data_finalizacao, forma_pagamento, status,
           operador_id, caixa_id, terminal_id,
           cliente:clientes(nome, nome_fantasia),
           itens:venda_itens(
             id, produto_id, descricao, quantidade, preco_unitario, desconto, total,
             produto:produtos(nome, sku, codigo_barras, preco_custo)
           )`,
        )
        .gte("data_emissao", inicio)
        .lte("data_emissao", fim)
        .order("data_emissao", { ascending: false })
        .limit(5000);

      if (!incluirCanceladas) {
        query = query.neq("status", "cancelada");
      }

      const { data, error } = await query;
      if (error) throw error;

      const rows: ItemVendaRow[] = [];
      for (const v of (data ?? []) as Array<Record<string, unknown>>) {
        const itens = (v.itens as Array<Record<string, unknown>> | null) ?? [];
        const cli = v.cliente as Record<string, unknown> | null;
        const clienteNome = cli
          ? ((cli.nome_fantasia as string) || (cli.nome as string) || null)
          : null;
        for (const it of itens) {
          const prod = it.produto as Record<string, unknown> | null;
          const qtd = Number(it.quantidade) || 0;
          const preco = Number(it.preco_unitario) || 0;
          const total = Number(it.total) || qtd * preco;
          const custoUnit = prod ? Number(prod.preco_custo) || 0 : 0;
          const custoTotal = custoUnit * qtd;
          const lucro = total - custoTotal;
          const margem = total > 0 ? (lucro / total) * 100 : 0;
          rows.push({
            item_id: it.id as string,
            venda_id: v.id as string,
            venda_numero: v.numero as string,
            data_emissao: v.data_emissao as string,
            data_finalizacao: (v.data_finalizacao as string | null) ?? null,
            produto_id: (it.produto_id as string | null) ?? null,
            produto_nome:
              (prod?.nome as string) || (it.descricao as string) || "—",
            sku: prod ? ((prod.sku as string) ?? null) : null,
            codigo_barras: prod ? ((prod.codigo_barras as string) ?? null) : null,
            quantidade: qtd,
            preco_unitario: preco,
            desconto: Number(it.desconto) || 0,
            total,
            custo_unitario: custoUnit,
            custo_total: custoTotal,
            lucro,
            margem,
            forma_pagamento: (v.forma_pagamento as string | null) ?? null,
            operador_id: (v.operador_id as string | null) ?? null,
            caixa_id: (v.caixa_id as string | null) ?? null,
            terminal_id: (v.terminal_id as string | null) ?? null,
            cliente_nome: clienteNome,
            status_venda: v.status as string,
          });
        }
      }
      return rows;
    },
  });
}

function RelatorioProdutosVendidosPage() {
  return (
    <ModuloGate chave="relatorios" titulo="Produtos Vendidos">
      <Conteudo />
    </ModuloGate>
  );
}

function Conteudo() {
  const navigate = useNavigate();
  const { data: funcionarios = [] } = useFuncionariosAtivos();
  const { data: caixasHistorico = [] } = useCaixasHistorico(200);

  const [preset, setPreset] = useState<PeriodoPreset>("hoje");
  const [inicioCustom, setInicioCustom] = useState("");
  const [fimCustom, setFimCustom] = useState("");
  const [operadorFiltro, setOperadorFiltro] = useState("todos");
  const [terminalFiltro, setTerminalFiltro] = useState("todos");
  const [formaFiltro, setFormaFiltro] = useState("todos");
  const [busca, setBusca] = useState("");
  const [incluirCanceladas, setIncluirCanceladas] = useState(false);
  const [produtoDetalhe, setProdutoDetalhe] = useState<{
    id: string | null;
    nome: string;
  } | null>(null);
  const [exportingFor, setExportingFor] = useState<"detalhado" | "consolidado" | null>(
    null,
  );
  const [exportOpen, setExportOpen] = useState<null | "detalhado" | "consolidado">(
    null,
  );

  const { inicio, fim } = useMemo(() => {
    if (preset === "personalizado" && inicioCustom && fimCustom) {
      return { inicio: inicioCustom, fim: fimCustom };
    }
    return calcRange(preset);
  }, [preset, inicioCustom, fimCustom]);

  const { data: itens = [], isLoading } = useItensVendidos(
    inicio,
    fim,
    incluirCanceladas,
  );

  useEffect(() => {
    // nothing
  }, [preset]);

  // Lista de terminais únicos presentes nas vendas do período
  const terminaisOptions = useMemo(() => {
    const set = new Set<string>();
    for (const i of itens) {
      if (i.terminal_id) set.add(i.terminal_id);
    }
    return Array.from(set);
  }, [itens]);

  const filtered = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return itens.filter((i) => {
      // Cancelados nunca entram nas métricas principais
      if (!incluirCanceladas && i.status_venda === "cancelada") return false;
      if (operadorFiltro !== "todos") {
        if (operadorFiltro === "_sem") {
          if (i.operador_id) return false;
        } else if (i.operador_id !== operadorFiltro) return false;
      }
      if (terminalFiltro !== "todos") {
        if (terminalFiltro === "_sem") {
          if (i.terminal_id) return false;
        } else if (i.terminal_id !== terminalFiltro) return false;
      }
      if (formaFiltro !== "todos" && i.forma_pagamento !== formaFiltro)
        return false;
      if (q) {
        const ok =
          i.produto_nome.toLowerCase().includes(q) ||
          (i.sku ?? "").toLowerCase().includes(q) ||
          (i.codigo_barras ?? "").toLowerCase().includes(q) ||
          i.venda_numero.toLowerCase().includes(q);
        if (!ok) return false;
      }
      return true;
    });
  }, [itens, busca, operadorFiltro, terminalFiltro, formaFiltro, incluirCanceladas]);

  // Métricas
  const metricas = useMemo(() => {
    const ativos = filtered.filter((i) => i.status_venda !== "cancelada");
    let qtd = 0;
    let receita = 0;
    let custo = 0;
    const vendasSet = new Set<string>();
    for (const i of ativos) {
      qtd += i.quantidade;
      receita += i.total;
      custo += i.custo_total;
      vendasSet.add(i.venda_id);
    }
    const lucro = receita - custo;
    const margem = receita > 0 ? (lucro / receita) * 100 : 0;
    return {
      qtd,
      receita,
      custo,
      lucro,
      margem,
      vendas: vendasSet.size,
      itens: ativos.length,
    };
  }, [filtered]);

  // Consolidado por produto
  const consolidado = useMemo(() => {
    const map = new Map<
      string,
      {
        produto_id: string | null;
        produto_nome: string;
        sku: string | null;
        codigo_barras: string | null;
        quantidade: number;
        receita: number;
        custo: number;
        lucro: number;
        margem: number;
        vendas: number;
      }
    >();
    const ativos = filtered.filter((i) => i.status_venda !== "cancelada");
    const vendasPorProd = new Map<string, Set<string>>();
    for (const i of ativos) {
      const key = i.produto_id ?? `__nome__${i.produto_nome}`;
      const cur = map.get(key) ?? {
        produto_id: i.produto_id,
        produto_nome: i.produto_nome,
        sku: i.sku,
        codigo_barras: i.codigo_barras,
        quantidade: 0,
        receita: 0,
        custo: 0,
        lucro: 0,
        margem: 0,
        vendas: 0,
      };
      cur.quantidade += i.quantidade;
      cur.receita += i.total;
      cur.custo += i.custo_total;
      map.set(key, cur);
      const set = vendasPorProd.get(key) ?? new Set<string>();
      set.add(i.venda_id);
      vendasPorProd.set(key, set);
    }
    const rows = Array.from(map.entries()).map(([k, v]) => {
      v.lucro = v.receita - v.custo;
      v.margem = v.receita > 0 ? (v.lucro / v.receita) * 100 : 0;
      v.vendas = vendasPorProd.get(k)?.size ?? 0;
      return v;
    });
    rows.sort((a, b) => b.quantidade - a.quantidade);
    return rows;
  }, [filtered]);

  const operadoresMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of funcionarios) m.set(f.id, f.nome);
    return m;
  }, [funcionarios]);

  const periodoLegivel = useMemo(() => {
    if (inicio === fim)
      return format(new Date(inicio + "T00:00:00"), "dd/MM/yyyy");
    return `${format(new Date(inicio + "T00:00:00"), "dd/MM/yyyy")} a ${format(
      new Date(fim + "T00:00:00"),
      "dd/MM/yyyy",
    )}`;
  }, [inicio, fim]);

  function limparFiltros() {
    setPreset("hoje");
    setInicioCustom("");
    setFimCustom("");
    setOperadorFiltro("todos");
    setTerminalFiltro("todos");
    setFormaFiltro("todos");
    setBusca("");
    setIncluirCanceladas(false);
  }

  const colunasDetalhado: CsvColumn<ItemVendaRow>[] = [
    { header: "Data", accessor: (r) => r.data_emissao, type: "date" },
    { header: "Venda", accessor: (r) => r.venda_numero, type: "text" },
    { header: "Produto", accessor: (r) => r.produto_nome, type: "text" },
    { header: "SKU", accessor: (r) => r.sku ?? "", type: "text" },
    { header: "Cod. barras", accessor: (r) => r.codigo_barras ?? "", type: "text" },
    { header: "Qtd", accessor: (r) => r.quantidade, type: "number" },
    { header: "Preço unit.", accessor: (r) => r.preco_unitario, type: "currency" },
    { header: "Total", accessor: (r) => r.total, type: "currency" },
    { header: "Custo unit.", accessor: (r) => r.custo_unitario, type: "currency" },
    { header: "Custo total", accessor: (r) => r.custo_total, type: "currency" },
    { header: "Lucro", accessor: (r) => r.lucro, type: "currency" },
    { header: "Margem %", accessor: (r) => Number(r.margem.toFixed(2)), type: "number" },
    {
      header: "Operador",
      accessor: (r) => (r.operador_id ? operadoresMap.get(r.operador_id) ?? "" : ""),
      type: "text",
    },
    { header: "Terminal", accessor: (r) => r.terminal_id ?? "", type: "text" },
    {
      header: "Forma pgto",
      accessor: (r) =>
        r.forma_pagamento ? FORMA_LABEL[r.forma_pagamento] ?? r.forma_pagamento : "",
      type: "text",
    },
    { header: "Status", accessor: (r) => r.status_venda, type: "text" },
  ];

  type ConsRow = (typeof consolidado)[number];
  const colunasConsolidado: CsvColumn<ConsRow>[] = [
    { header: "Produto", accessor: (r) => r.produto_nome, type: "text" },
    { header: "SKU", accessor: (r) => r.sku ?? "", type: "text" },
    { header: "Cod. barras", accessor: (r) => r.codigo_barras ?? "", type: "text" },
    { header: "Qtd vendida", accessor: (r) => r.quantidade, type: "number" },
    { header: "Nº vendas", accessor: (r) => r.vendas, type: "integer" },
    { header: "Faturamento", accessor: (r) => r.receita, type: "currency" },
    { header: "Custo total", accessor: (r) => r.custo, type: "currency" },
    { header: "Lucro bruto", accessor: (r) => r.lucro, type: "currency" },
    { header: "Margem %", accessor: (r) => Number(r.margem.toFixed(2)), type: "number" },
  ];

  async function handleExport(
    formato: ExportFormato,
    tipo: "detalhado" | "consolidado",
  ) {
    setExportOpen(null);
    setExportingFor(tipo);
    toast.loading("Gerando relatório...", { id: `export-pv-${tipo}` });
    try {
      if (tipo === "detalhado") {
        if (filtered.length === 0) {
          toast.warning("Sem dados para exportar.", { id: `export-pv-${tipo}` });
          return;
        }
        await exportarRelatorioCard(formato, {
          prefix: "produtos-vendidos-detalhado",
          titulo: "Produtos Vendidos — Detalhado",
          periodo: periodoLegivel,
          resumo: [
            { label: "Quantidade", valor: metricas.qtd.toLocaleString("pt-BR") },
            { label: "Faturamento", valor: formatBRL(metricas.receita), tone: "success" },
            { label: "Custo", valor: formatBRL(metricas.custo) },
            { label: "Lucro bruto", valor: formatBRL(metricas.lucro), tone: "success" },
            { label: "Margem", valor: `${metricas.margem.toFixed(2)}%` },
          ],
          rows: filtered,
          columns: colunasDetalhado,
        });
      } else {
        if (consolidado.length === 0) {
          toast.warning("Sem dados para exportar.", { id: `export-pv-${tipo}` });
          return;
        }
        await exportarRelatorioCard(formato, {
          prefix: "produtos-vendidos-consolidado",
          titulo: "Produtos Vendidos — Consolidado",
          periodo: periodoLegivel,
          resumo: [
            { label: "Produtos", valor: consolidado.length.toLocaleString("pt-BR") },
            { label: "Qtd total", valor: metricas.qtd.toLocaleString("pt-BR") },
            { label: "Faturamento", valor: formatBRL(metricas.receita), tone: "success" },
            { label: "Lucro bruto", valor: formatBRL(metricas.lucro), tone: "success" },
            { label: "Margem", valor: `${metricas.margem.toFixed(2)}%` },
          ],
          rows: consolidado,
          columns: colunasConsolidado,
        });
      }
      toast.success("Download iniciado", { id: `export-pv-${tipo}` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao exportar";
      toast.error(msg, { id: `export-pv-${tipo}` });
    } finally {
      setExportingFor(null);
    }
  }

  const topPorQtd = consolidado.slice(0, 10);
  const topPorReceita = [...consolidado]
    .sort((a, b) => b.receita - a.receita)
    .slice(0, 10);
  const topPorLucro = [...consolidado]
    .sort((a, b) => b.lucro - a.lucro)
    .slice(0, 10);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Produtos Vendidos"
        description="Análise de produtos vendidos: quantidade, faturamento, custo, lucro e margem."
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
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => window.print()}
            >
              <Printer className="h-4 w-4" />
              Imprimir
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
                  <SelectItem value="semana">Esta semana</SelectItem>
                  <SelectItem value="mes">Este mês</SelectItem>
                  <SelectItem value="mes_anterior">Mês anterior</SelectItem>
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
              <label className="text-xs font-medium text-muted-foreground">Operador</label>
              <Select value={operadorFiltro} onValueChange={setOperadorFiltro}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="_sem">Sem operador</SelectItem>
                  {funcionarios.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Terminal/PDV</label>
              <Select value={terminalFiltro} onValueChange={setTerminalFiltro}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="_sem">Sem terminal</SelectItem>
                  {terminaisOptions.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.slice(0, 8)}
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
                  {Object.entries(FORMA_LABEL).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Buscar produto / venda
              </label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Nome, SKU, código, nº venda..."
                  className="pl-8"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button
                variant={incluirCanceladas ? "default" : "outline"}
                size="sm"
                onClick={() => setIncluirCanceladas((v) => !v)}
              >
                {incluirCanceladas ? "Ocultar canceladas" : "Incluir canceladas"}
              </Button>
              <Button variant="ghost" size="sm" onClick={limparFiltros}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Limpar
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              Período: <span className="font-medium text-foreground">{periodoLegivel}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Métricas */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Qtd vendida"
          value={metricas.qtd.toLocaleString("pt-BR")}
          icon={Hash}
        />
        <StatCard
          title="Faturamento"
          value={formatBRL(metricas.receita)}
          icon={DollarSign}
        />
        <StatCard
          title="Lucro bruto"
          value={formatBRL(metricas.lucro)}
          icon={TrendingUp}
        />
        <StatCard
          title="Margem média"
          value={`${metricas.margem.toFixed(2)}%`}
          icon={Package}
        />
      </div>

      <Tabs defaultValue="consolidado">
        <TabsList>
          <TabsTrigger value="consolidado">Consolidado por produto</TabsTrigger>
          <TabsTrigger value="detalhado">Detalhado por venda</TabsTrigger>
          <TabsTrigger value="rankings">Rankings</TabsTrigger>
        </TabsList>

        <TabsContent value="consolidado" className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {consolidado.length} produto(s) — total {metricas.qtd.toLocaleString("pt-BR")} un.
            </p>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={exportingFor !== null || isLoading}
              onClick={() => setExportOpen("consolidado")}
            >
              {exportingFor === "consolidado" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Exportar
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Qtd</TableHead>
                      <TableHead className="text-right">Vendas</TableHead>
                      <TableHead className="text-right">Faturamento</TableHead>
                      <TableHead className="text-right">Custo</TableHead>
                      <TableHead className="text-right">Lucro</TableHead>
                      <TableHead className="text-right">Margem</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                        </TableCell>
                      </TableRow>
                    ) : consolidado.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                          Nenhum produto vendido no período.
                        </TableCell>
                      </TableRow>
                    ) : (
                      consolidado.map((r) => (
                        <TableRow key={(r.produto_id ?? r.produto_nome) + r.sku}>
                          <TableCell className="font-medium">{r.produto_nome}</TableCell>
                          <TableCell className="text-muted-foreground">{r.sku ?? "—"}</TableCell>
                          <TableCell className="text-right">
                            {r.quantidade.toLocaleString("pt-BR")}
                          </TableCell>
                          <TableCell className="text-right">{r.vendas}</TableCell>
                          <TableCell className="text-right">{formatBRL(r.receita)}</TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {formatBRL(r.custo)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right font-medium",
                              r.lucro >= 0 ? "text-success" : "text-destructive",
                            )}
                          >
                            {formatBRL(r.lucro)}
                          </TableCell>
                          <TableCell className="text-right">{r.margem.toFixed(1)}%</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setProdutoDetalhe({
                                  id: r.produto_id,
                                  nome: r.produto_nome,
                                })
                              }
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="detalhado" className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {filtered.length} item(ns) vendido(s)
            </p>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={exportingFor !== null || isLoading}
              onClick={() => setExportOpen("detalhado")}
            >
              {exportingFor === "detalhado" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Exportar
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Venda</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Qtd</TableHead>
                      <TableHead className="text-right">Unit.</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Lucro</TableHead>
                      <TableHead>Operador</TableHead>
                      <TableHead>Forma</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={11} className="py-8 text-center text-muted-foreground">
                          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                        </TableCell>
                      </TableRow>
                    ) : filtered.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={11} className="py-8 text-center text-muted-foreground">
                          Nenhum item no período / filtros.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filtered.slice(0, 500).map((i) => (
                        <TableRow key={i.item_id}>
                          <TableCell className="text-xs">
                            {format(new Date(i.data_emissao + "T00:00:00"), "dd/MM/yyyy")}
                            {i.data_finalizacao && (
                              <span className="ml-1 text-muted-foreground">
                                {format(new Date(i.data_finalizacao), "HH:mm")}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{i.venda_numero}</TableCell>
                          <TableCell className="font-medium">{i.produto_nome}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {i.sku ?? "—"}
                          </TableCell>
                          <TableCell className="text-right">{i.quantidade}</TableCell>
                          <TableCell className="text-right">{formatBRL(i.preco_unitario)}</TableCell>
                          <TableCell className="text-right font-medium">
                            {formatBRL(i.total)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right",
                              i.lucro >= 0 ? "text-success" : "text-destructive",
                            )}
                          >
                            {formatBRL(i.lucro)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {i.operador_id ? operadoresMap.get(i.operador_id) ?? "—" : "—"}
                          </TableCell>
                          <TableCell className="text-xs">
                            {i.forma_pagamento
                              ? FORMA_LABEL[i.forma_pagamento] ?? i.forma_pagamento
                              : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                i.status_venda === "cancelada"
                                  ? "border-destructive/30 bg-destructive/15 text-destructive"
                                  : "border-success/30 bg-success/15 text-success"
                              }
                            >
                              {i.status_venda}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
                {filtered.length > 500 && (
                  <p className="p-3 text-center text-xs text-muted-foreground">
                    Mostrando 500 de {filtered.length} itens. Use os filtros para refinar ou
                    exporte para ver todos.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rankings" className="grid gap-4 lg:grid-cols-3">
          <RankingCard title="Mais vendidos (qtd)" data={topPorQtd} format="qtd" />
          <RankingCard title="Maior faturamento" data={topPorReceita} format="receita" />
          <RankingCard title="Maior lucro" data={topPorLucro} format="lucro" />
        </TabsContent>
      </Tabs>

      <ExportFormatDialog
        open={exportOpen !== null}
        onOpenChange={(o) => !o && setExportOpen(null)}
        titulo={
          exportOpen === "consolidado"
            ? "Produtos Vendidos — Consolidado"
            : "Produtos Vendidos — Detalhado"
        }
        loading={exportingFor !== null}
        onChoose={(f) => exportOpen && handleExport(f, exportOpen)}
      />

      <DetalheProdutoDialog
        produto={produtoDetalhe}
        itens={filtered.filter((i) =>
          produtoDetalhe?.id
            ? i.produto_id === produtoDetalhe.id
            : i.produto_nome === produtoDetalhe?.nome,
        )}
        operadoresMap={operadoresMap}
        onClose={() => setProdutoDetalhe(null)}
      />
    </div>
  );
}

function RankingCard({
  title,
  data,
  format: fmt,
}: {
  title: string;
  data: Array<{
    produto_nome: string;
    quantidade: number;
    receita: number;
    lucro: number;
  }>;
  format: "qtd" | "receita" | "lucro";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="mb-3 text-sm font-semibold">{title}</h3>
        {data.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sem dados.</p>
        ) : (
          <ol className="space-y-1.5 text-sm">
            {data.map((r, idx) => (
              <li
                key={r.produto_nome + idx}
                className="flex items-center justify-between gap-2 border-b border-border/50 pb-1.5 last:border-0"
              >
                <span className="flex items-center gap-2 truncate">
                  <span className="w-5 text-xs text-muted-foreground">{idx + 1}.</span>
                  <span className="truncate">{r.produto_nome}</span>
                </span>
                <span className="shrink-0 font-medium tabular-nums">
                  {fmt === "qtd"
                    ? r.quantidade.toLocaleString("pt-BR")
                    : fmt === "receita"
                      ? formatBRL(r.receita)
                      : formatBRL(r.lucro)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function DetalheProdutoDialog({
  produto,
  itens,
  operadoresMap,
  onClose,
}: {
  produto: { id: string | null; nome: string } | null;
  itens: ItemVendaRow[];
  operadoresMap: Map<string, string>;
  onClose: () => void;
}) {
  return (
    <Dialog open={produto !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{produto?.nome}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Venda</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Operador</TableHead>
                <TableHead>Forma</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {itens.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                    Sem vendas para este produto.
                  </TableCell>
                </TableRow>
              ) : (
                itens.map((i) => (
                  <TableRow key={i.item_id}>
                    <TableCell className="text-xs">
                      {format(new Date(i.data_emissao + "T00:00:00"), "dd/MM/yyyy")}
                      {i.data_finalizacao && (
                        <span className="ml-1 text-muted-foreground">
                          {format(new Date(i.data_finalizacao), "HH:mm")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{i.venda_numero}</TableCell>
                    <TableCell>{i.cliente_nome ?? "Consumidor"}</TableCell>
                    <TableCell className="text-right">{i.quantidade}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatBRL(i.total)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {i.operador_id ? operadoresMap.get(i.operador_id) ?? "—" : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {i.forma_pagamento
                        ? FORMA_LABEL[i.forma_pagamento] ?? i.forma_pagamento
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
