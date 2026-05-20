import { dataClient } from "@/integrations/data/client";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Plus,
  TrendingUp,
  ShoppingCart,
  Package,
  Wallet,
  Clock,
  AlertTriangle,
  Receipt,
  HandCoins,
  UtensilsCrossed,
  Download,
  FileText,
  Sheet as SheetIcon,
  Search,
  CalendarClock,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL } from "@/lib/mock-data";
import { ModuloGate } from "@/components/saas/ModuloGate";
import { RequirePermission } from "@/components/auth/RequirePermission";
import {
  LancamentoDetalheDialog,
  type LancamentoDetalhe,
} from "@/components/financeiro/LancamentoDetalheDialog";
import { ConciliarIfoodDialog } from "@/components/financeiro/ConciliarIfoodDialog";
import { CaixaRelatorioDialog } from "@/components/caixa/CaixaRelatorioDialog";
import { LancamentoFormDialog } from "@/components/financeiro/LancamentoFormDialog";
import {
  BlocoDetalheDialog,
  type DetalheColumn,
  type DetalheRow,
} from "@/components/financeiro/BlocoDetalheDialog";
import { useFinanceiroIndicadores } from "@/hooks/useFinanceiroIndicadores";
import {
  usePosicaoFinanceira,
  usePerformancePeriodo,
  useReceberOrigem,
} from "@/hooks/useFinanceiroSecoes";
import { SecaoFiltro, type SecaoFiltroValue } from "@/components/financeiro/SecaoFiltro";
import { SecaoExport } from "@/components/financeiro/SecaoExport";
import { formatPeriodoBR } from "@/lib/dateRange";
import { exportarBlocoCSV, exportarBlocoPDF } from "@/lib/export-bloco";
import { ExportFormatDialog } from "@/components/shared/ExportFormatDialog";
import { exportarRelatorioCard, type ExportFormato } from "@/lib/export-relatorio-card";
import { toast } from "sonner";
import { CarteiraDialog } from "@/components/financeiro/CarteiraDialog";
import { SaldoPrevistoDialog } from "@/components/financeiro/SaldoPrevistoDialog";
import { useFinanceiroResultadoReal } from "@/hooks/useFinanceiroResultadoReal";


type FinTab = "receber" | "pagar" | "fluxo" | "fluxo-financeiro";

export const Route = createFileRoute("/financeiro")({
  validateSearch: (search: Record<string, unknown>): { tab?: FinTab } => {
    const t = search.tab;
    return t === "pagar" || t === "receber" || t === "fluxo" || t === "fluxo-financeiro"
      ? { tab: t }
      : {};
  },
  head: () => ({
    meta: [
      { title: "Financeiro — Gestão Pro" },
      { name: "description", content: "Contas a pagar, a receber e fluxo de caixa." },
    ],
  }),
  component: FinancePage,
});

type Lancamento = LancamentoDetalhe;

function statusLabel(l: Lancamento): string {
  if (l.status === "pago" || l.status === "recebido") return "Pago";
  if (l.status === "cancelado") return "Cancelado";
  if (l.status === "parcial") return "Parcial";
  // pendente: avaliar vencimento
  if (l.data_vencimento && new Date(l.data_vencimento) < new Date(new Date().toDateString())) {
    return "Vencido";
  }
  return "Pendente";
}

function formatDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function FinancePage() {
  return (
    <RequirePermission permission="financeiro">
      <ModuloGate chave="financeiro_avancado" titulo="Financeiro Avançado">
        <FinanceContent />
      </ModuloGate>
    </RequirePermission>
  );
}

type BlocoChave =
  | "receber"
  | "pagar"
  | "saldo"
  | "vendido"
  | "custo"
  | "lucro"
  | "fiado"
  | "ifood"
  | "recebidoHoje"
  | "vencidos";

interface ConsolidadoRow {
  indicador: string;
  quantidade: number;
  valor: number;
}

function buildConsolidado(args: {
  totalRec: number;
  totalPay: number;
  saldo: number;
  receber: Lancamento[];
  pagar: Lancamento[];
  ind: ReturnType<typeof useFinanceiroIndicadores>["data"] | undefined;
}): ConsolidadoRow[] {
  const { totalRec, totalPay, saldo, receber, pagar, ind } = args;
  const rows: ConsolidadoRow[] = [
    { indicador: "Total a receber", quantidade: receber.length, valor: totalRec },
    { indicador: "Total a pagar", quantidade: pagar.length, valor: totalPay },
    { indicador: "Saldo previsto", quantidade: 0, valor: saldo },
  ];
  if (ind) {
    rows.push(
      { indicador: "Total vendido (mês)", quantidade: ind.qtdVendas, valor: ind.totalVendido },
      { indicador: "Custo dos produtos vendidos", quantidade: ind.qtdItens, valor: ind.custoTotal },
      { indicador: "Lucro bruto", quantidade: 0, valor: ind.lucroBruto },
      { indicador: "Fiado em aberto", quantidade: ind.qtdFiado, valor: ind.fiadoEmAberto },
      { indicador: "iFood a repassar", quantidade: ind.qtdIfood, valor: ind.ifoodAReceber },
      { indicador: "Recebido hoje", quantidade: ind.qtdRecebimentosHoje, valor: ind.recebidoHoje },
      { indicador: "Vencidos", quantidade: ind.qtdVencidos, valor: ind.vencidosTotal },
    );
  }
  return rows;
}

function FinanceContent() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const activeTab: FinTab = tab ?? "receber";
  const [selected, setSelected] = useState<Lancamento | null>(null);
  const [blocoAberto, setBlocoAberto] = useState<BlocoChave | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [novoOpen, setNovoOpen] = useState(false);

  // Filtros independentes por seção
  const [filtroPosicao, setFiltroPosicao] = useState<SecaoFiltroValue>({ preset: "mes" });
  const [filtroPerformance, setFiltroPerformance] = useState<SecaoFiltroValue>({ preset: "mes" });
  const [filtroReceber, setFiltroReceber] = useState<SecaoFiltroValue>({
    preset: "hoje",
    forma: "todos",
  });

  const posicao = usePosicaoFinanceira(filtroPosicao).data;
  const performance = usePerformancePeriodo(filtroPerformance).data;
  const receberOrigem = useReceberOrigem(filtroReceber).data;
  const resultadoReal = useFinanceiroResultadoReal();

  const indicadores = useFinanceiroIndicadores();
  const ind = indicadores.data;

  const { data: lancamentos = [], isLoading } = useQuery({
    queryKey: ["financeiro_lancamentos"],
    queryFn: async () => {
      const data = await dataClient.financeiro.listLancamentosCompleto();
      return data as Lancamento[];
    },
  });

  const receber = lancamentos.filter(
    (l) => l.tipo === "receber" && l.status !== "recebido" && l.status !== "cancelado",
  );
  const pagar = lancamentos.filter(
    (l) => l.tipo === "pagar" && l.status !== "pago" && l.status !== "cancelado",
  );

  const totalRec = receber.reduce((s, l) => s + Number(l.valor) - Number(l.valor_pago ?? 0), 0);
  const totalPay = pagar.reduce((s, l) => s + Number(l.valor) - Number(l.valor_pago ?? 0), 0);
  const saldo = totalRec - totalPay;

  // DEV log — Posição financeira
  useEffect(() => {
    if (typeof window === "undefined" || !import.meta.env.DEV) return;
    if (!posicao) return;
    // eslint-disable-next-line no-console
    console.log("[POSICAO_FINANCEIRA]", {
      total_a_receber: posicao.totalReceber,
      qtd_receber: posicao.qtdReceber,
      total_a_pagar: posicao.totalPagar,
      qtd_pagar: posicao.qtdPagar,
      saldo_previsto: posicao.saldo,
      periodo: { inicio: posicao.periodo.inicio, fim: posicao.periodo.fim },
    });
  }, [posicao]);

  const consolidado = useMemo(
    () => buildConsolidado({ totalRec, totalPay, saldo, receber, pagar, ind }),
    [totalRec, totalPay, saldo, receber, pagar, ind],
  );

  const periodoTexto = ind
    ? `${formatDate(ind.periodo.inicio)} a ${formatDate(ind.periodo.fim)}`
    : null;

  async function handleExportConsolidado(formato: ExportFormato) {
    setExporting(true);
    toast.loading("Gerando exportação...", { id: "export-fin" });
    try {
      await exportarRelatorioCard(formato, {
        prefix: "financeiro_consolidado",
        titulo: "Financeiro — Resumo consolidado",
        periodo: periodoTexto,
        rows: consolidado,
        columns: [
          { header: "Indicador", accessor: (r: ConsolidadoRow) => r.indicador, type: "text" },
          { header: "Quantidade", accessor: (r: ConsolidadoRow) => r.quantidade, type: "integer" },
          { header: "Valor (R$)", accessor: (r: ConsolidadoRow) => r.valor, type: "currency" },
        ],
      });
      toast.success("Exportação concluída.", { id: "export-fin" });
      setExportOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao exportar.", {
        id: "export-fin",
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financeiro"
        description="Acompanhe entradas, saídas, lucro e fluxo de caixa."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setExportOpen(true)}
              disabled={exporting}
            >
              <Download className="h-4 w-4" />
              Exportar resumo
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => setNovoOpen(true)}>
              <Plus className="h-4 w-4" />
              Novo lançamento
            </Button>
          </div>
        }
      />

      {/* Bloco 1: Posição financeira */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Posição financeira
          </p>
          <div className="flex items-center gap-2">
            {posicao && (
              <span className="hidden text-[11px] text-muted-foreground sm:inline">
                {formatPeriodoBR(posicao.periodo)}
              </span>
            )}
            <SecaoFiltro value={filtroPosicao} onChange={setFiltroPosicao} />
            <SecaoExport
              prefix="financeiro_posicao"
              titulo="Posição financeira"
              periodo={posicao ? formatPeriodoBR(posicao.periodo) : null}
              rows={[
                {
                  indicador: "Total a receber",
                  valor: posicao?.totalReceber ?? 0,
                  quantidade: posicao?.qtdReceber ?? 0,
                  filtro: posicao ? formatPeriodoBR(posicao.periodo) : null,
                },
                {
                  indicador: "Total a pagar",
                  valor: posicao?.totalPagar ?? 0,
                  quantidade: posicao?.qtdPagar ?? 0,
                  filtro: posicao ? formatPeriodoBR(posicao.periodo) : null,
                },
                {
                  indicador: "Saldo previsto",
                  valor: posicao?.saldo ?? 0,
                  quantidade: null,
                  filtro: posicao ? formatPeriodoBR(posicao.periodo) : null,
                },
              ]}
              disabled={!posicao}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="Total a receber"
            value={formatBRL(posicao?.totalReceber ?? 0)}
            icon={ArrowDownToLine}
            iconTone="success"
            hint={`${posicao?.qtdReceber ?? 0} títulos`}
            onClick={() => setBlocoAberto("receber")}
          />
          <StatCard
            label="Total a pagar"
            value={formatBRL(posicao?.totalPagar ?? 0)}
            icon={ArrowUpFromLine}
            iconTone="warning"
            hint={`${posicao?.qtdPagar ?? 0} títulos`}
            onClick={() => setBlocoAberto("pagar")}
          />
          <StatCard
            label="Saldo previsto"
            value={formatBRL(posicao?.saldo ?? 0)}
            icon={TrendingUp}
            iconTone={(posicao?.saldo ?? 0) >= 0 ? "success" : "danger"}
            onClick={() => setBlocoAberto("saldo")}
          />
        </div>
      </div>

      {/* Bloco 2: Performance */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Performance do período
          </p>
          <div className="flex items-center gap-2">
            {performance && (
              <span className="hidden text-[11px] text-muted-foreground sm:inline">
                {formatPeriodoBR(performance.periodo)}
              </span>
            )}
            <SecaoFiltro value={filtroPerformance} onChange={setFiltroPerformance} />
            <SecaoExport
              prefix="financeiro_performance"
              titulo="Performance do período"
              periodo={performance ? formatPeriodoBR(performance.periodo) : null}
              rows={[
                {
                  indicador: "Total vendido",
                  valor: performance?.totalVendido ?? 0,
                  quantidade: performance?.qtdVendas ?? 0,
                  filtro: performance ? formatPeriodoBR(performance.periodo) : null,
                },
                {
                  indicador: "Custo dos produtos vendidos",
                  valor: performance?.custoTotal ?? 0,
                  quantidade: performance?.qtdItens ?? 0,
                  filtro: performance ? formatPeriodoBR(performance.periodo) : null,
                },
                {
                  indicador: "Lucro bruto",
                  valor: performance?.lucroBruto ?? 0,
                  quantidade: null,
                  filtro: performance ? formatPeriodoBR(performance.periodo) : null,
                },
                {
                  indicador: `Margem (${(performance?.margemPct ?? 0).toFixed(1)}%)`,
                  valor: performance?.margemPct ?? 0,
                  quantidade: null,
                  filtro: performance ? formatPeriodoBR(performance.periodo) : null,
                },
              ]}
              disabled={!performance}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Total vendido"
            value={formatBRL(performance?.totalVendido ?? 0)}
            icon={ShoppingCart}
            iconTone="info"
            hint={`${performance?.qtdVendas ?? 0} vendas`}
            onClick={() => setBlocoAberto("vendido")}
          />
          <StatCard
            label="Custo dos produtos vendidos"
            value={formatBRL(performance?.custoTotal ?? 0)}
            icon={Package}
            iconTone="warning"
            hint={
              performance && performance.qtdItensSemCusto > 0
                ? `${performance.qtdItensSemCusto} sem custo`
                : `${performance?.qtdItens ?? 0} itens`
            }
            onClick={() => setBlocoAberto("custo")}
          />
          <StatCard
            label="Lucro bruto"
            value={formatBRL(performance?.lucroBruto ?? 0)}
            icon={TrendingUp}
            iconTone={(performance?.lucroBruto ?? 0) >= 0 ? "success" : "danger"}
            hint={`Margem ${(performance?.margemPct ?? 0).toFixed(1)}%`}
            onClick={() => setBlocoAberto("lucro")}
          />
        </div>
      </div>

      {/* Bloco Resultado Real — motor financeiro Onda 3 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Resultado real (recebido x previsto)
          </p>
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            Baseado em pagamentos efetivos · taxas e custos proporcionais
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard
            label="Receita bruta"
            value={formatBRL(resultadoReal.resultado.receita_bruta)}
            icon={ShoppingCart}
            iconTone="info"
          />
          <StatCard
            label="Recebido"
            value={formatBRL(resultadoReal.resultado.recebido)}
            icon={ArrowDownToLine}
            iconTone="success"
          />
          <StatCard
            label="Previsto / pendente"
            value={formatBRL(resultadoReal.resultado.pendente)}
            icon={Clock}
            iconTone="warning"
          />
          <StatCard
            label="Taxas pagas"
            value={formatBRL(resultadoReal.resultado.taxas)}
            icon={Receipt}
            iconTone="warning"
          />
          <StatCard
            label="Custo realizado"
            value={formatBRL(resultadoReal.resultado.custos_realizados)}
            icon={Package}
            iconTone="warning"
            hint={`Pendente ${formatBRL(resultadoReal.resultado.custos_pendentes)}`}
          />
          <StatCard
            label="Resultado operacional"
            value={formatBRL(resultadoReal.resultado.resultado_operacional_real)}
            icon={TrendingUp}
            iconTone={resultadoReal.resultado.resultado_operacional_real >= 0 ? "success" : "danger"}
            hint={`Lucro líq. ${formatBRL(resultadoReal.resultado.lucro_liquido)}`}
          />
        </div>

        {/* Tabela: vendas por forma de pagamento */}
        {resultadoReal.porForma.length > 0 && (() => {
          const totalRecebidoForma = resultadoReal.porForma.reduce((s, l) => s + l.total_recebido, 0);
          return (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Forma</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                    <TableHead className="text-right">Vendido</TableHead>
                    <TableHead className="text-right">Recebido</TableHead>
                    <TableHead className="text-right">Taxa</TableHead>
                    <TableHead className="text-right">Líquido</TableHead>
                    <TableHead className="text-right">Participação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resultadoReal.porForma.map((l) => {
                    const liquido = l.total_recebido - l.taxa;
                    const part = totalRecebidoForma > 0 ? (l.total_recebido / totalRecebidoForma) * 100 : 0;
                    return (
                      <TableRow key={l.forma}>
                        <TableCell className="font-medium capitalize">{l.forma}</TableCell>
                        <TableCell className="text-right">{l.qtd_vendas}</TableCell>
                        <TableCell className="text-right">{formatBRL(l.total_vendido)}</TableCell>
                        <TableCell className="text-right">{formatBRL(l.total_recebido)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {formatBRL(l.taxa)}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatBRL(liquido)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {part.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          );
        })()}

      </div>



      {/* Bloco 3: A receber por origem + operacional */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            A receber por origem e operacional
          </p>
          <div className="flex items-center gap-2">
            {receberOrigem && (
              <span className="hidden text-[11px] text-muted-foreground sm:inline">
                {formatPeriodoBR(receberOrigem.periodo)}
              </span>
            )}
            <SecaoFiltro value={filtroReceber} onChange={setFiltroReceber} showForma />
            {(() => {
              const periodoLabel = receberOrigem
                ? formatPeriodoBR(receberOrigem.periodo)
                : null;
              const formaLabel =
                filtroReceber.forma && filtroReceber.forma !== "todos"
                  ? `Forma: ${filtroReceber.forma}`
                  : "Todas as formas";
              const filtroTxt = periodoLabel
                ? `${periodoLabel} · ${formaLabel}`
                : formaLabel;
              const labelRecebido =
                filtroReceber.preset === "hoje"
                  ? "Recebido hoje"
                  : "Recebido no período";
              return (
                <SecaoExport
                  prefix="financeiro_receber_origem"
                  titulo="A receber por origem e operacional"
                  periodo={periodoLabel}
                  rows={[
                    {
                      indicador: "Fiado em aberto",
                      valor: receberOrigem?.fiadoEmAberto ?? 0,
                      quantidade: receberOrigem?.qtdFiado ?? 0,
                      filtro: filtroTxt,
                    },
                    {
                      indicador: "iFood a repassar",
                      valor: receberOrigem?.ifoodAReceber ?? 0,
                      quantidade: receberOrigem?.qtdIfood ?? 0,
                      filtro: filtroTxt,
                    },
                    {
                      indicador: labelRecebido,
                      valor: receberOrigem?.recebidoPeriodo ?? 0,
                      quantidade: receberOrigem?.qtdRecebimentos ?? 0,
                      filtro: filtroTxt,
                    },
                    {
                      indicador: "Vencidos",
                      valor: receberOrigem?.vencidosTotal ?? 0,
                      quantidade: receberOrigem?.qtdVencidos ?? 0,
                      filtro: filtroTxt,
                    },
                  ]}
                  disabled={!receberOrigem}
                />
              );
            })()}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Fiado em aberto"
            value={formatBRL(receberOrigem?.fiadoEmAberto ?? 0)}
            icon={HandCoins}
            iconTone="info"
            hint={`${receberOrigem?.qtdFiado ?? 0} títulos`}
            onClick={() => setBlocoAberto("fiado")}
          />
          <StatCard
            label="iFood a repassar"
            value={formatBRL(receberOrigem?.ifoodAReceber ?? 0)}
            icon={UtensilsCrossed}
            iconTone="warning"
            hint={`${receberOrigem?.qtdIfood ?? 0} pendentes`}
            onClick={() => setBlocoAberto("ifood")}
          />
          <StatCard
            label={filtroReceber.preset === "hoje" ? "Recebido hoje" : "Recebido no período"}
            value={formatBRL(receberOrigem?.recebidoPeriodo ?? 0)}
            icon={Wallet}
            iconTone="success"
            hint={`${receberOrigem?.qtdRecebimentos ?? 0} recebimentos`}
            onClick={() => setBlocoAberto("recebidoHoje")}
          />
          <StatCard
            label="Vencidos"
            value={formatBRL(receberOrigem?.vencidosTotal ?? 0)}
            icon={AlertTriangle}
            iconTone="danger"
            hint={`${receberOrigem?.qtdVencidos ?? 0} títulos`}
            onClick={() => setBlocoAberto("vencidos")}
          />
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) =>
          navigate({ search: { tab: v === "receber" ? undefined : (v as FinTab) }, replace: true })
        }
      >
        <TabsList>
          <TabsTrigger value="receber">Contas a receber</TabsTrigger>
          <TabsTrigger value="pagar">Contas a pagar</TabsTrigger>
          <TabsTrigger value="fluxo">Caixa Operacional</TabsTrigger>
          <TabsTrigger value="fluxo-financeiro">Fluxo Financeiro</TabsTrigger>
        </TabsList>

        <TabsContent value="receber" className="mt-4">
          <LancamentosTable
            items={receber}
            loading={isLoading}
            emptyMsg="Nenhuma conta a receber."
            onSelect={setSelected}
          />
        </TabsContent>

        <TabsContent value="pagar" className="mt-4">
          <ContasPagarPanel
            items={pagar}
            loading={isLoading}
            onSelect={setSelected}
          />
        </TabsContent>

        <TabsContent value="fluxo" className="mt-4">
          <FluxoCaixaPanel />
        </TabsContent>

        <TabsContent value="fluxo-financeiro" className="mt-4">
          <FluxoFinanceiroPanel />
        </TabsContent>
      </Tabs>

      <LancamentoDetalheDialog
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        lancamento={selected}
      />

      <LancamentoFormDialog
        mode="create"
        open={novoOpen}
        onOpenChange={setNovoOpen}
        tipoInicial={activeTab === "pagar" ? "pagar" : "receber"}
      />

      <BlocoModais
        bloco={
          blocoAberto === "receber" || blocoAberto === "pagar" || blocoAberto === "saldo"
            ? null
            : blocoAberto
        }
        onClose={() => setBlocoAberto(null)}
        receber={receber}
        pagar={pagar}
        totalRec={totalRec}
        totalPay={totalPay}
        saldo={saldo}
        ind={ind}
      />

      <CarteiraDialog
        open={blocoAberto === "receber"}
        onOpenChange={(o) => !o && setBlocoAberto(null)}
        tipo="receber"
        lancamentos={lancamentos}
        onSelect={(l) => {
          setBlocoAberto(null);
          setSelected(l);
        }}
      />

      <CarteiraDialog
        open={blocoAberto === "pagar"}
        onOpenChange={(o) => !o && setBlocoAberto(null)}
        tipo="pagar"
        lancamentos={lancamentos}
        onSelect={(l) => {
          setBlocoAberto(null);
          setSelected(l);
        }}
      />

      <SaldoPrevistoDialog
        open={blocoAberto === "saldo"}
        onOpenChange={(o) => !o && setBlocoAberto(null)}
        lancamentos={lancamentos}
        periodoInicio={posicao?.periodo.inicio ?? new Date().toISOString().slice(0, 10)}
        periodoFim={posicao?.periodo.fim ?? new Date().toISOString().slice(0, 10)}
      />

      <ExportFormatDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        titulo="Financeiro — Resumo consolidado"
        loading={exporting}
        onChoose={(f) => handleExportConsolidado(f)}
      />
    </div>
  );
}

function BlocoModais({
  bloco,
  onClose,
  receber,
  pagar,
  totalRec,
  totalPay,
  saldo,
  ind,
}: {
  bloco: BlocoChave | null;
  onClose: () => void;
  receber: Lancamento[];
  pagar: Lancamento[];
  totalRec: number;
  totalPay: number;
  saldo: number;
  ind: ReturnType<typeof useFinanceiroIndicadores>["data"] | undefined;
}) {
  if (!bloco) return null;

  const lancamentoCols: DetalheColumn[] = [
    { key: "descricao", header: "Descrição" },
    { key: "vencimento", header: "Vencimento", format: "date" },
    { key: "valor", header: "Valor", format: "currency", align: "right" },
    { key: "status", header: "Status" },
  ];

  const lancRows = (items: Lancamento[]): DetalheRow[] =>
    items.map((l) => ({
      id: l.id,
      descricao: l.descricao,
      vencimento: l.data_vencimento,
      valor: Number(l.valor) - Number(l.valor_pago ?? 0),
      status: statusLabel(l),
    }));

  if (bloco === "receber") {
    return (
      <BlocoDetalheDialog
        open
        onOpenChange={(o) => !o && onClose()}
        titulo="Total a receber"
        subtitulo="Títulos em aberto a receber"
        origem="financeiro_lancamentos"
        resumo={[
          { label: "Total em aberto", valor: formatBRL(totalRec), tone: "success" },
          { label: "Qtd. títulos", valor: String(receber.length) },
        ]}
        colunas={lancamentoCols}
        rows={lancRows(receber)}
      />
    );
  }
  if (bloco === "pagar") {
    return (
      <BlocoDetalheDialog
        open
        onOpenChange={(o) => !o && onClose()}
        titulo="Total a pagar"
        subtitulo="Contas a pagar em aberto"
        origem="financeiro_lancamentos"
        resumo={[
          { label: "Total em aberto", valor: formatBRL(totalPay), tone: "danger" },
          { label: "Qtd. títulos", valor: String(pagar.length) },
        ]}
        colunas={lancamentoCols}
        rows={lancRows(pagar)}
      />
    );
  }
  if (bloco === "saldo") {
    return (
      <BlocoDetalheDialog
        open
        onOpenChange={(o) => !o && onClose()}
        titulo="Saldo previsto"
        subtitulo="Composição: a receber − a pagar"
        origem="financeiro_lancamentos"
        resumo={[
          { label: "A receber", valor: formatBRL(totalRec), tone: "success" },
          { label: "A pagar", valor: formatBRL(totalPay), tone: "danger" },
          { label: "Saldo", valor: formatBRL(saldo), tone: saldo >= 0 ? "success" : "danger" },
        ]}
        colunas={[
          { key: "indicador", header: "Indicador" },
          { key: "valor", header: "Valor", format: "currency", align: "right" },
        ]}
        rows={[
          { id: "r", indicador: "Total a receber", valor: totalRec },
          { id: "p", indicador: "Total a pagar", valor: -totalPay },
          { id: "s", indicador: "Saldo previsto", valor: saldo },
        ]}
      />
    );
  }

  // Blocos baseados em ind (mês atual)
  if (!ind) {
    return (
      <BlocoDetalheDialog
        open
        onOpenChange={(o) => !o && onClose()}
        titulo="Carregando…"
        origem="—"
        resumo={[]}
        colunas={[{ key: "info", header: "Status" }]}
        rows={[{ id: "1", info: "Aguardando dados do mês" }]}
      />
    );
  }

  const periodoLabel = `${formatDate(ind.periodo.inicio)} a ${formatDate(ind.periodo.fim)}`;

  if (bloco === "vendido") {
    return (
      <BlocoDetalheDialog
        open
        onOpenChange={(o) => !o && onClose()}
        titulo="Total vendido"
        subtitulo={`Período: ${periodoLabel}`}
        origem="vendas finalizadas"
        resumo={[
          { label: "Total vendido", valor: formatBRL(ind.totalVendido), tone: "success" },
          { label: "Qtd. vendas", valor: String(ind.qtdVendas) },
          {
            label: "Ticket médio",
            valor: formatBRL(ind.qtdVendas > 0 ? ind.totalVendido / ind.qtdVendas : 0),
          },
        ]}
        colunas={[
          { key: "numero", header: "Nº" },
          { key: "data", header: "Data", format: "datetime" },
          { key: "cliente", header: "Cliente" },
          { key: "forma", header: "Forma" },
          { key: "total", header: "Total", format: "currency", align: "right" },
        ]}
        vendaIdField="venda_id"
        rows={ind.vendasDetalhe.map((v) => ({
          id: v.id,
          venda_id: v.id,
          numero: v.numero,
          data: v.data,
          cliente: v.cliente_nome ?? "Consumidor final",
          forma: v.forma_pagamento ?? "—",
          total: v.total,
        }))}
      />
    );
  }
  if (bloco === "custo" || bloco === "lucro") {
    const isLucro = bloco === "lucro";
    const semCustoTotal = ind.itensDetalhe
      .filter((i) => i.sem_custo)
      .reduce((s, i) => s + i.total_venda, 0);
    return (
      <BlocoDetalheDialog
        open
        onOpenChange={(o) => !o && onClose()}
        titulo={isLucro ? "Lucro bruto" : "Custo dos produtos vendidos"}
        subtitulo={`Período: ${periodoLabel}`}
        origem="venda_itens × produtos.preco_custo"
        resumo={[
          { label: "Total vendido", valor: formatBRL(ind.totalVendido) },
          { label: "Custo total", valor: formatBRL(ind.custoTotal), tone: "danger" },
          {
            label: "Lucro bruto",
            valor: formatBRL(ind.lucroBruto),
            tone: ind.lucroBruto >= 0 ? "success" : "danger",
          },
        ]}
        alertaSemCusto={
          ind.qtdItensSemCusto > 0 ? { qtd: ind.qtdItensSemCusto, total: semCustoTotal } : null
        }
        colunas={[
          { key: "numero", header: "Venda" },
          { key: "produto", header: "Produto" },
          { key: "qtd", header: "Qtd", format: "number", align: "right" },
          { key: "venda", header: "Total venda", format: "currency", align: "right" },
          { key: "custo", header: "Custo", format: "currency", align: "right" },
          { key: "lucro", header: "Lucro", format: "currency", align: "right" },
        ]}
        vendaIdField="venda_id"
        rows={ind.itensDetalhe.map((it, idx) => ({
          id: `${it.venda_id}-${idx}`,
          venda_id: it.venda_id,
          numero: it.venda_numero,
          produto: it.sem_custo ? `${it.produto_nome} ⚠` : it.produto_nome,
          qtd: it.quantidade,
          venda: it.total_venda,
          custo: it.total_custo,
          lucro: it.lucro,
        }))}
      />
    );
  }
  if (bloco === "fiado") {
    const fiadosLanc = receber.filter((l) => l.forma_pagamento === "fiado");
    return (
      <BlocoDetalheDialog
        open
        onOpenChange={(o) => !o && onClose()}
        titulo="Fiado em aberto"
        subtitulo="Vendas em fiado pendentes de recebimento"
        origem="financeiro_lancamentos (forma=fiado)"
        resumo={[
          { label: "Total fiado", valor: formatBRL(ind.fiadoEmAberto), tone: "info" },
          { label: "Qtd. títulos", valor: String(ind.qtdFiado) },
        ]}
        colunas={[
          { key: "descricao", header: "Descrição" },
          { key: "cliente", header: "Cliente" },
          { key: "vencimento", header: "Vencimento", format: "date" },
          { key: "valor", header: "Valor", format: "currency", align: "right" },
        ]}
        vendaIdField="venda_id"
        rows={fiadosLanc.map((l) => ({
          id: l.id,
          venda_id: l.venda_id,
          descricao: l.descricao,
          cliente: l.cliente_nome ?? "—",
          vencimento: l.data_vencimento,
          valor: Number(l.valor) - Number(l.valor_pago ?? 0),
        }))}
      />
    );
  }
  if (bloco === "ifood") {
    const ifoodLanc = receber.filter((l) => l.forma_pagamento === "ifood" && !l.conciliado_em);
    return (
      <BlocoDetalheDialog
        open
        onOpenChange={(o) => !o && onClose()}
        titulo="iFood a repassar"
        subtitulo="Vendas iFood aguardando conciliação"
        origem="financeiro_lancamentos (forma=ifood, não conciliado)"
        resumo={[
          { label: "Total iFood", valor: formatBRL(ind.ifoodAReceber), tone: "info" },
          { label: "Qtd. pendentes", valor: String(ind.qtdIfood) },
        ]}
        colunas={[
          { key: "descricao", header: "Descrição" },
          { key: "vencimento", header: "Vencimento", format: "date" },
          { key: "valor", header: "Valor", format: "currency", align: "right" },
        ]}
        vendaIdField="venda_id"
        rows={ifoodLanc.map((l) => ({
          id: l.id,
          venda_id: l.venda_id,
          descricao: l.descricao,
          vencimento: l.data_vencimento,
          valor: Number(l.valor) - Number(l.valor_pago ?? 0),
        }))}
      />
    );
  }
  if (bloco === "recebidoHoje") {
    return (
      <BlocoDetalheDialog
        open
        onOpenChange={(o) => !o && onClose()}
        titulo="Recebido hoje"
        subtitulo={`Recebimentos do dia ${formatDate(ind.periodo.hoje)}`}
        origem="financeiro_lancamentos (data_pagamento = hoje)"
        resumo={[
          { label: "Total recebido", valor: formatBRL(ind.recebidoHoje), tone: "success" },
          { label: "Qtd. recebimentos", valor: String(ind.qtdRecebimentosHoje) },
        ]}
        colunas={[{ key: "info", header: "Detalhes" }]}
        rows={[
          {
            id: "1",
            info:
              ind.qtdRecebimentosHoje > 0
                ? `${ind.qtdRecebimentosHoje} recebimentos totalizando ${formatBRL(ind.recebidoHoje)}`
                : "Nenhum recebimento registrado hoje",
          },
        ]}
      />
    );
  }
  if (bloco === "vencidos") {
    const vencidosLanc = [...receber, ...pagar].filter((l) => {
      if (!l.data_vencimento) return false;
      return new Date(l.data_vencimento) < new Date(new Date().toDateString());
    });
    return (
      <BlocoDetalheDialog
        open
        onOpenChange={(o) => !o && onClose()}
        titulo="Vencidos"
        subtitulo="Títulos com vencimento anterior a hoje"
        origem="financeiro_lancamentos"
        resumo={[
          { label: "Total vencido", valor: formatBRL(ind.vencidosTotal), tone: "danger" },
          { label: "Qtd. títulos", valor: String(ind.qtdVencidos) },
        ]}
        colunas={[
          { key: "descricao", header: "Descrição" },
          { key: "tipo", header: "Tipo" },
          { key: "vencimento", header: "Vencimento", format: "date" },
          { key: "valor", header: "Valor", format: "currency", align: "right" },
        ]}
        vendaIdField="venda_id"
        rows={vencidosLanc.map((l) => ({
          id: l.id,
          venda_id: l.venda_id,
          descricao: l.descricao,
          tipo: l.tipo === "receber" ? "A receber" : "A pagar",
          vencimento: l.data_vencimento,
          valor: Number(l.valor) - Number(l.valor_pago ?? 0),
        }))}
      />
    );
  }
  return null;
}

function LancamentosTable({
  items,
  loading,
  emptyMsg,
  onSelect,
}: {
  items: Lancamento[];
  loading: boolean;
  emptyMsg: string;
  onSelect?: (l: Lancamento) => void;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Descrição</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  Carregando…
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  {emptyMsg}
                </TableCell>
              </TableRow>
            ) : (
              items.map((i) => (
                <TableRow
                  key={i.id}
                  onClick={() => onSelect?.(i)}
                  className={
                    onSelect ? "cursor-pointer transition-colors hover:bg-muted/50" : undefined
                  }
                >
                  <TableCell className="font-medium">{i.descricao}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(i.data_vencimento)}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatBRL(Number(i.valor))}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={statusLabel(i)} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Contas a Pagar — com filtros por vencimento, busca e alertas visuais
// ============================================================================

type VencFiltro = "todas" | "vencidas" | "vence_hoje" | "vence_7d" | "vence_30d" | "futuras" | "sem_data";

const VENC_LABEL: Record<VencFiltro, string> = {
  todas: "Todas",
  vencidas: "Vencidas",
  vence_hoje: "Vence hoje",
  vence_7d: "Próximos 7 dias",
  vence_30d: "Próximos 30 dias",
  futuras: "A vencer",
  sem_data: "Sem vencimento",
};

function diasParaVencer(d: string | null): number | null {
  if (!d) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const [y, m, day] = d.split("-").map(Number);
  const venc = new Date(y, (m ?? 1) - 1, day ?? 1);
  venc.setHours(0, 0, 0, 0);
  return Math.round((venc.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
}

function ContasPagarPanel({
  items,
  loading,
  onSelect,
}: {
  items: Lancamento[];
  loading: boolean;
  onSelect?: (l: Lancamento) => void;
}) {
  const [filtro, setFiltro] = useState<VencFiltro>("todas");
  const [busca, setBusca] = useState("");

  const buckets = useMemo(() => {
    const b = {
      vencidas: 0,
      vence_hoje: 0,
      vence_7d: 0,
      vence_30d: 0,
      futuras: 0,
      sem_data: 0,
      totalVencido: 0,
      total7d: 0,
    };
    for (const l of items) {
      const d = diasParaVencer(l.data_vencimento);
      const aberto = Number(l.valor) - Number(l.valor_pago ?? 0);
      if (d === null) {
        b.sem_data++;
        continue;
      }
      if (d < 0) {
        b.vencidas++;
        b.totalVencido += aberto;
      } else if (d === 0) {
        b.vence_hoje++;
        b.total7d += aberto;
      } else if (d <= 7) {
        b.vence_7d++;
        b.total7d += aberto;
      } else if (d <= 30) {
        b.vence_30d++;
      } else {
        b.futuras++;
      }
    }
    return b;
  }, [items]);

  const filtered = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return items.filter((l) => {
      if (q && !l.descricao.toLowerCase().includes(q)) return false;
      if (filtro === "todas") return true;
      const d = diasParaVencer(l.data_vencimento);
      if (filtro === "sem_data") return d === null;
      if (d === null) return false;
      if (filtro === "vencidas") return d < 0;
      if (filtro === "vence_hoje") return d === 0;
      if (filtro === "vence_7d") return d >= 0 && d <= 7;
      if (filtro === "vence_30d") return d >= 0 && d <= 30;
      if (filtro === "futuras") return d > 0;
      return true;
    });
  }, [items, busca, filtro]);

  const chips: { key: VencFiltro; count: number; tone?: "danger" | "warning" }[] = [
    { key: "todas", count: items.length },
    { key: "vencidas", count: buckets.vencidas, tone: "danger" },
    { key: "vence_hoje", count: buckets.vence_hoje, tone: "warning" },
    { key: "vence_7d", count: buckets.vence_7d, tone: "warning" },
    { key: "vence_30d", count: buckets.vence_30d },
    { key: "futuras", count: buckets.futuras },
    { key: "sem_data", count: buckets.sem_data },
  ];

  return (
    <div className="space-y-3">
      {(buckets.vencidas > 0 || buckets.vence_7d > 0 || buckets.vence_hoje > 0) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {buckets.vencidas > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <p className="font-semibold text-destructive">
                  {buckets.vencidas} {buckets.vencidas === 1 ? "título vencido" : "títulos vencidos"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Total em aberto: <strong>{formatBRL(buckets.totalVencido)}</strong>
                </p>
              </div>
            </div>
          )}
          {buckets.vence_hoje + buckets.vence_7d > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div>
                <p className="font-semibold text-warning">
                  {buckets.vence_hoje + buckets.vence_7d} vence{buckets.vence_hoje + buckets.vence_7d > 1 ? "m" : ""} em até 7 dias
                </p>
                <p className="text-xs text-muted-foreground">
                  Total: <strong>{formatBRL(buckets.total7d)}</strong>
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por descrição..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setFiltro(c.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
              filtro === c.key
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:bg-muted/40",
              c.tone === "danger" && filtro !== c.key && "text-destructive",
              c.tone === "warning" && filtro !== c.key && "text-warning",
            )}
          >
            {VENC_LABEL[c.key]}
            <span
              className={cn(
                "rounded-full bg-muted px-1.5 text-[10px] tabular-nums",
                filtro === c.key && "bg-primary/20",
              )}
            >
              {c.count}
            </span>
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descrição</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    Carregando…
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    Nenhuma conta encontrada para o filtro.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((i) => {
                  const d = diasParaVencer(i.data_vencimento);
                  const vencido = d !== null && d < 0;
                  const proximo = d !== null && d >= 0 && d <= 7;
                  return (
                    <TableRow
                      key={i.id}
                      onClick={() => onSelect?.(i)}
                      className={cn(
                        onSelect && "cursor-pointer transition-colors hover:bg-muted/50",
                        vencido && "bg-destructive/5",
                      )}
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {vencido && <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
                          {proximo && !vencido && (
                            <CalendarClock className="h-3.5 w-3.5 text-warning" />
                          )}
                          {i.descricao}
                        </div>
                      </TableCell>
                      <TableCell
                        className={cn(
                          vencido
                            ? "font-medium text-destructive"
                            : proximo
                              ? "font-medium text-warning"
                              : "text-muted-foreground",
                        )}
                      >
                        {formatDate(i.data_vencimento)}
                        {d !== null && (
                          <span className="ml-1 text-[10px] opacity-70">
                            {d < 0
                              ? `(${Math.abs(d)}d atrás)`
                              : d === 0
                                ? "(hoje)"
                                : `(em ${d}d)`}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatBRL(Number(i.valor))}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={statusLabel(i)} />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Exibindo <strong>{filtered.length}</strong> de <strong>{items.length}</strong> registros
      </p>
    </div>
  );
}

// ============================================================================
// Caixa Operacional — APENAS movimentos do caixa do PDV
// (abertura, venda, sangria, suprimento, fechamento). Sem lançamentos
// financeiros administrativos (compras, fornecedores, despesas, iFood).
// ============================================================================

type FluxoPeriodo = "7d" | "30d" | "mes" | "ano";

type FluxoOperTipo =
  | "abertura"
  | "venda"
  | "sangria"
  | "suprimento"
  | "fechamento";

interface FluxoOperRow {
  id: string;
  data: string;
  tipo: FluxoOperTipo;
  descricao: string;
  valor: number;
  caixaId?: string | null;
  operacional?: boolean;
}

function calcRangeFluxo(p: FluxoPeriodo): { inicio: string; fim: string } {
  const today = new Date();
  const fim = today.toISOString().slice(0, 10);
  let inicio = new Date(today);
  if (p === "7d") inicio.setDate(today.getDate() - 6);
  else if (p === "30d") inicio.setDate(today.getDate() - 29);
  else if (p === "mes") inicio = new Date(today.getFullYear(), today.getMonth(), 1);
  else inicio = new Date(today.getFullYear(), 0, 1);
  return { inicio: inicio.toISOString().slice(0, 10), fim };
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

const TIPO_OPER_LABEL: Record<FluxoOperTipo, string> = {
  abertura: "Abertura de caixa",
  venda: "Venda",
  sangria: "Sangria de caixa",
  suprimento: "Suprimento de caixa",
  fechamento: "Fechamento de caixa",
};

const FORMA_LABELS: Record<string, string> = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  cartao_debito: "Débito",
  cartao_credito: "Crédito",
  boleto: "Boleto",
  ifood: "iFood",
  fiado: "Fiado",
  transferencia: "Transferência",
  cheque: "Cheque",
  outro: "Outro",
};

function FluxoCaixaPanel() {
  const [periodo, setPeriodo] = useState<FluxoPeriodo>("30d");
  const { inicio, fim } = useMemo(() => calcRangeFluxo(periodo), [periodo]);

  const { data: porForma = [] } = useQuery({
    queryKey: ["financeiro", "fluxo-por-forma", inicio, fim],
    queryFn: () => dataClient.financeiro.fluxoPorForma({ inicio, fim }),
    staleTime: 15_000,
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["financeiro", "caixa-operacional", inicio, fim],
    queryFn: async (): Promise<FluxoOperRow[]> => {
      const movs = await dataClient.financeiro.movimentosCaixaPeriodo({ inicio, fim });
      const movRows: FluxoOperRow[] = movs.map((m) => {
        const tipo = m.tipo as FluxoOperTipo;
        const bruto = Number(m.valor) || 0;
        let valor = bruto;
        if (tipo === "sangria" || tipo === "fechamento") valor = -Math.abs(bruto);
        else valor = Math.abs(bruto);
        const operacional = tipo === "abertura" || tipo === "fechamento";
        return {
          id: `mov-${m.id}`,
          data: m.created_at,
          tipo,
          descricao: m.motivo ?? TIPO_OPER_LABEL[tipo] ?? "Movimento de caixa",
          valor,
          operacional,
          caixaId: m.caixa_id,
        };
      });
      const ordered = movRows.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
      console.log("[FLUXO_OPERACIONAL]", {
        origem: "caixa_movimentos",
        periodo: { inicio, fim },
        registros: ordered.length,
      });
      console.log("[CAIXA_OPERACIONAL]", {
        periodo: { inicio, fim },
        total: ordered.length,
      });
      return ordered;
    },
    staleTime: 15_000,
  });

  const totais = useMemo(() => {
    let entradas = 0;
    let saidas = 0;
    let vendas = 0;
    let sangrias = 0;
    let suprimentos = 0;
    let qtdVendas = 0;
    let fundoAberturas = 0;
    for (const r of rows) {
      if (r.tipo === "abertura") {
        fundoAberturas += Math.abs(r.valor);
        continue;
      }
      if (r.operacional) continue;
      if (r.tipo === "venda") {
        vendas += r.valor;
        qtdVendas += 1;
      }
      if (r.tipo === "sangria") sangrias += Math.abs(r.valor);
      if (r.tipo === "suprimento") suprimentos += r.valor;
      if (r.valor >= 0) entradas += r.valor;
      else saidas += Math.abs(r.valor);
    }
    return {
      entradas,
      saidas,
      vendas,
      sangrias,
      suprimentos,
      qtdVendas,
      esperadoGaveta: fundoAberturas + entradas - saidas,
      fundoAberturas,
    };
  }, [rows]);

  const rowsComSaldo = useMemo(() => {
    const ordenadas = [...rows].sort((a, b) => (a.data < b.data ? -1 : 1));
    let acc = 0;
    const map = new Map<string, number>();
    for (const r of ordenadas) {
      if (!r.operacional) acc += r.valor;
      map.set(r.id, acc);
    }
    return rows.map((r) => ({ ...r, saldoAcumulado: map.get(r.id) ?? 0 }));
  }, [rows]);

  const [caixaRelatorio, setCaixaRelatorio] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="text-sm text-muted-foreground">
          Apenas movimentos do <strong>Caixa/PDV</strong>: abertura, vendas, sangrias, suprimentos e
          fechamento. Despesas administrativas e compras vivem em{" "}
          <strong>Fluxo Financeiro</strong>.
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <Select value={periodo} onValueChange={(v) => setPeriodo(v as FluxoPeriodo)}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Últimos 7 dias</SelectItem>
              <SelectItem value="30d">Últimos 30 dias</SelectItem>
              <SelectItem value="mes">Este mês</SelectItem>
              <SelectItem value="ano">Este ano</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Entradas operacionais"
          value={formatBRL(totais.entradas)}
          icon={ArrowDownToLine}
          iconTone="success"
          hint="Vendas + suprimentos"
        />
        <StatCard
          label="Saídas operacionais"
          value={formatBRL(totais.saidas)}
          icon={ArrowUpFromLine}
          iconTone="warning"
          hint="Sangrias do caixa"
        />
        <StatCard
          label="Total vendido"
          value={formatBRL(totais.vendas)}
          icon={TrendingUp}
          iconTone="success"
          hint={`${totais.qtdVendas} vendas no PDV`}
        />
        <StatCard
          label="Esperado na gaveta"
          value={formatBRL(totais.esperadoGaveta)}
          icon={Wallet}
          iconTone="info"
          hint={`Fundo ${formatBRL(totais.fundoAberturas)} + entradas − saídas`}
        />
      </div>

      <div className="rounded-md border border-dashed border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
        <strong className="text-foreground">Como ler:</strong> esta tela é o{" "}
        <em>caixa do operador</em>. Despesas, compras, fornecedores, iFood e contas a pagar não
        aparecem aqui — abra a aba <strong>Fluxo Financeiro</strong> para a visão gerencial.
      </div>

      {porForma.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Recebido por forma de pagamento</h3>
              <span className="text-[11px] text-muted-foreground">
                Vendas finalizadas no período
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {porForma.map((p) => (
                <div key={p.forma} className="rounded-md border border-border bg-card/40 p-3">
                  <p className="text-xs text-muted-foreground">
                    {FORMA_LABELS[p.forma] ?? p.forma}
                  </p>
                  <p className="font-mono text-base font-semibold tabular-nums">
                    {formatBRL(p.recebido)}
                  </p>
                  {p.aReceber > 0.005 && (
                    <p className="mt-0.5 text-[11px] text-warning">
                      A receber: {formatBRL(p.aReceber)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[160px]">Data</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">Saldo acumulado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    Carregando…
                  </TableCell>
                </TableRow>
              ) : rowsComSaldo.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    Nenhuma movimentação de caixa no período.
                  </TableCell>
                </TableRow>
              ) : (
                rowsComSaldo.map((r) => (
                  <TableRow
                    key={r.id}
                    className={cn(
                      r.operacional && "bg-muted/30",
                      r.caixaId && "cursor-pointer hover:bg-muted/50",
                    )}
                    onClick={r.caixaId ? () => setCaixaRelatorio(r.caixaId!) : undefined}
                    title={r.caixaId ? "Abrir relatório do caixa" : undefined}
                  >
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(r.data)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "font-normal",
                          r.operacional && "border-info/40 bg-info/10 text-info",
                        )}
                      >
                        {TIPO_OPER_LABEL[r.tipo]}
                        {r.operacional && (
                          <span className="ml-1 text-[10px] opacity-80">• operacional</span>
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className={cn("font-medium", r.operacional && "text-muted-foreground")}
                    >
                      {r.descricao}
                    </TableCell>
                    <TableCell>
                      <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs text-primary">
                        PDV / Caixa
                      </span>
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-medium tabular-nums",
                        r.operacional
                          ? "text-muted-foreground italic"
                          : r.valor > 0
                            ? "text-success"
                            : r.valor < 0
                              ? "text-destructive"
                              : "",
                      )}
                    >
                      {r.valor === 0
                        ? "—"
                        : r.operacional
                          ? `(${formatBRL(Math.abs(r.valor))})`
                          : formatBRL(r.valor)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {formatBRL(r.saldoAcumulado)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CaixaRelatorioDialog
        open={!!caixaRelatorio}
        onOpenChange={(o) => !o && setCaixaRelatorio(null)}
        caixaId={caixaRelatorio}
      />
    </div>
  );
}

// ============================================================================
// Fluxo Financeiro Gerencial — APENAS lançamentos administrativos
// (compras, despesas, fornecedores, contas a pagar/receber, iFood, etc.)
// Sem movimentos do caixa do PDV.
// ============================================================================

interface FluxoFinRow {
  id: string;
  data: string;
  tipo: "receita" | "despesa";
  descricao: string;
  valor: number;
  status?: string | null;
}

function FluxoFinanceiroPanel() {
  const [periodo, setPeriodo] = useState<FluxoPeriodo>("30d");
  const { inicio, fim } = useMemo(() => calcRangeFluxo(periodo), [periodo]);
  const [conciliarLoteOpen, setConciliarLoteOpen] = useState(false);
  const resultadoReal = useFinanceiroResultadoReal();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["financeiro", "fluxo-financeiro", inicio, fim],
    queryFn: async (): Promise<FluxoFinRow[]> => {
      const lancs = await dataClient.financeiro.lancamentosAvulsosPagos({ inicio, fim });
      const out: FluxoFinRow[] = lancs.map((l) => {
        const v = Number(l.valor_pago ?? l.valor) || 0;
        const isReceita = l.tipo === "receber" || l.tipo === "receita";
        return {
          id: `lanc-${l.id}`,
          data: l.data_pagamento ?? `${inicio}T00:00:00`,
          tipo: isReceita ? "receita" : "despesa",
          descricao: l.descricao,
          valor: isReceita ? Math.abs(v) : -Math.abs(v),
          status: l.status,
        };
      });
      const ordered = out.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
      console.log("[FLUXO_FINANCEIRO]", {
        origem: "financeiro_lancamentos",
        periodo: { inicio, fim },
        registros: ordered.length,
      });
      console.log("[FINANCEIRO_GERENCIAL]", {
        periodo: { inicio, fim },
        total: ordered.length,
      });
      return ordered;
    },
    staleTime: 15_000,
  });

  const totais = useMemo(() => {
    let receitas = 0;
    let despesas = 0;
    for (const r of rows) {
      if (r.valor >= 0) receitas += r.valor;
      else despesas += Math.abs(r.valor);
    }
    return { receitas, despesas, saldo: receitas - despesas };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="text-sm text-muted-foreground">
          Visão <strong>gerencial</strong>: compras, despesas, fornecedores, contas a pagar/receber,
          iFood, receitas extras. Movimentos do PDV ficam em{" "}
          <strong>Caixa Operacional</strong>.
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConciliarLoteOpen(true)}
            className="gap-1.5"
          >
            <Receipt className="h-4 w-4" />
            Conciliar repasse iFood
          </Button>
          <Select value={periodo} onValueChange={(v) => setPeriodo(v as FluxoPeriodo)}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Últimos 7 dias</SelectItem>
              <SelectItem value="30d">Últimos 30 dias</SelectItem>
              <SelectItem value="mes">Este mês</SelectItem>
              <SelectItem value="ano">Este ano</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Receitas"
          value={formatBRL(totais.receitas)}
          icon={ArrowDownToLine}
          iconTone="success"
          hint="Lançamentos recebidos no período"
        />
        <StatCard
          label="Despesas"
          value={formatBRL(totais.despesas)}
          icon={ArrowUpFromLine}
          iconTone="warning"
          hint="Lançamentos pagos no período"
        />
        <StatCard
          label="Saldo gerencial"
          value={formatBRL(totais.saldo)}
          icon={TrendingUp}
          iconTone={totais.saldo >= 0 ? "success" : "danger"}
          hint="Receitas − Despesas"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[160px]">Data</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    Carregando…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    Nenhum lançamento financeiro no período.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(r.data)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal capitalize">
                        {r.tipo}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{r.descricao}</TableCell>
                    <TableCell className="text-muted-foreground capitalize">
                      {r.status ?? "—"}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-medium tabular-nums",
                        r.valor > 0
                          ? "text-success"
                          : r.valor < 0
                            ? "text-destructive"
                            : "",
                      )}
                    >
                      {formatBRL(r.valor)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ConciliarIfoodDialog
        open={conciliarLoteOpen}
        onOpenChange={setConciliarLoteOpen}
        mode="lote"
      />
    </div>
  );
}
