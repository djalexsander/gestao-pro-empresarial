import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
} from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import {
  LancamentoDetalheDialog,
  type LancamentoDetalhe,
} from "@/components/financeiro/LancamentoDetalheDialog";
import { ConciliarIfoodDialog } from "@/components/financeiro/ConciliarIfoodDialog";
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

type FinTab = "receber" | "pagar" | "fluxo";

export const Route = createFileRoute("/financeiro")({
  validateSearch: (search: Record<string, unknown>): { tab?: FinTab } => {
    const t = search.tab;
    return t === "pagar" || t === "receber" || t === "fluxo" ? { tab: t } : {};
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

  const indicadores = useFinanceiroIndicadores();
  const ind = indicadores.data;

  const { data: lancamentos = [], isLoading } = useQuery({
    queryKey: ["financeiro_lancamentos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financeiro_lancamentos")
        .select(
          `id, descricao, valor, valor_pago, data_vencimento, data_pagamento, data_emissao,
           tipo, status, observacoes, numero_documento, forma_pagamento, created_at,
           conciliado_em, valor_repasse, taxa_repasse, numero_repasse, observacao_repasse,
           cliente_id, venda_id,
           fornecedor:fornecedores(razao_social, nome_fantasia, documento, telefone),
           cliente:clientes(nome, documento, telefone, celular, email),
           venda:vendas(numero, data_finalizacao, total),
           categoria:categorias_financeiras(nome)`,
        )
        .order("data_vencimento", { ascending: true });
      if (error) throw error;
      type Row = {
        id: string;
        descricao: string;
        valor: number;
        valor_pago: number | null;
        data_vencimento: string;
        data_pagamento: string | null;
        data_emissao: string | null;
        tipo: "receber" | "pagar";
        status: Lancamento["status"];
        observacoes: string | null;
        numero_documento: string | null;
        forma_pagamento: string | null;
        created_at: string | null;
        conciliado_em: string | null;
        valor_repasse: number | null;
        taxa_repasse: number | null;
        numero_repasse: string | null;
        observacao_repasse: string | null;
        cliente_id: string | null;
        venda_id: string | null;
        fornecedor: {
          razao_social: string | null;
          nome_fantasia: string | null;
          documento: string | null;
          telefone: string | null;
        } | null;
        cliente: {
          nome: string | null;
          documento: string | null;
          telefone: string | null;
          celular: string | null;
          email: string | null;
        } | null;
        venda: {
          numero: string | null;
          data_finalizacao: string | null;
          total: number | null;
        } | null;
        categoria: { nome: string | null } | null;
      };
      return ((data ?? []) as Row[]).map<Lancamento>((r) => ({
        id: r.id,
        descricao: r.descricao,
        valor: r.valor,
        valor_pago: r.valor_pago,
        data_vencimento: r.data_vencimento,
        data_pagamento: r.data_pagamento,
        data_emissao: r.data_emissao,
        tipo: r.tipo,
        status: r.status,
        observacoes: r.observacoes,
        numero_documento: r.numero_documento,
        forma_pagamento: r.forma_pagamento,
        created_at: r.created_at,
        conciliado_em: r.conciliado_em,
        valor_repasse: r.valor_repasse,
        taxa_repasse: r.taxa_repasse,
        numero_repasse: r.numero_repasse,
        observacao_repasse: r.observacao_repasse,
        cliente_id: r.cliente_id,
        venda_id: r.venda_id,
        fornecedor_nome: r.fornecedor?.nome_fantasia ?? r.fornecedor?.razao_social ?? null,
        fornecedor_documento: r.fornecedor?.documento ?? null,
        fornecedor_telefone: r.fornecedor?.telefone ?? null,
        cliente_nome: r.cliente?.nome ?? null,
        cliente_documento: r.cliente?.documento ?? null,
        cliente_telefone: r.cliente?.telefone ?? r.cliente?.celular ?? null,
        cliente_email: r.cliente?.email ?? null,
        venda_numero: r.venda?.numero ?? null,
        venda_data: r.venda?.data_finalizacao ?? null,
        venda_total: r.venda?.total ?? null,
        categoria_nome: r.categoria?.nome ?? null,
      }));
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
          <TabsTrigger value="fluxo">Fluxo de caixa</TabsTrigger>
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
          <LancamentosTable
            items={pagar}
            loading={isLoading}
            emptyMsg="Nenhuma conta a pagar."
            onSelect={setSelected}
          />
        </TabsContent>

        <TabsContent value="fluxo" className="mt-4">
          <FluxoCaixaPanel />
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
        bloco={blocoAberto}
        onClose={() => setBlocoAberto(null)}
        receber={receber}
        pagar={pagar}
        totalRec={totalRec}
        totalPay={totalPay}
        saldo={saldo}
        ind={ind}
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
        rows={ind.vendasDetalhe.map((v) => ({
          id: v.id,
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
        rows={ind.itensDetalhe.map((it, idx) => ({
          id: `${it.venda_id}-${idx}`,
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
        rows={fiadosLanc.map((l) => ({
          id: l.id,
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
        rows={ifoodLanc.map((l) => ({
          id: l.id,
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
        rows={vencidosLanc.map((l) => ({
          id: l.id,
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
// Fluxo de Caixa — consolidado a partir do módulo Caixa/Operacional
// (aberturas, vendas, sangrias, suprimentos, fechamentos) + lançamentos
// financeiros pagos/recebidos que NÃO vieram do caixa (para evitar duplicação).
// ============================================================================

type FluxoPeriodo = "7d" | "30d" | "mes" | "ano";

type FluxoTipo =
  | "abertura"
  | "venda"
  | "sangria"
  | "suprimento"
  | "fechamento"
  | "receita"
  | "despesa";

interface FluxoRow {
  id: string;
  data: string; // ISO timestamp
  tipo: FluxoTipo;
  origem: "caixa" | "financeiro";
  descricao: string;
  valor: number; // positivo = entrada, negativo = saída
  status?: string | null;
  // Operacional = não conta como receita/despesa real (fundo de troco,
  // encerramento). Apenas informativo no extrato.
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

const TIPO_LABEL: Record<FluxoTipo, string> = {
  abertura: "Abertura de caixa",
  venda: "Venda",
  sangria: "Sangria de caixa",
  suprimento: "Suprimento de caixa",
  fechamento: "Fechamento de caixa",
  receita: "Receita",
  despesa: "Despesa",
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

  // Breakdown por forma de pagamento das vendas no período
  const { data: porForma = [] } = useQuery({
    queryKey: ["financeiro", "fluxo-por-forma", inicio, fim],
    queryFn: async () => {
      const inicioTs = `${inicio}T00:00:00`;
      const fimTs = `${fim}T23:59:59.999`;

      // 1) Buscar vendas finalizadas no período (não canceladas)
      const { data: vendasData, error: errVendas } = await supabase
        .from("vendas")
        .select("id, status, status_pagamento")
        .gte("data_finalizacao", inicioTs)
        .lte("data_finalizacao", fimTs)
        .neq("status", "cancelada")
        .limit(5000);
      if (errVendas) throw errVendas;

      const vendaIds = (vendasData ?? []).map((v) => v.id);
      if (vendaIds.length === 0) {
        return [] as { forma: string; recebido: number; aReceber: number }[];
      }
      const vendaMap = new Map((vendasData ?? []).map((v) => [v.id, v] as const));

      // 2) Buscar pagamentos dessas vendas
      const { data: pagamentos, error: errPag } = await supabase
        .from("venda_pagamentos")
        .select("forma_pagamento, valor, valor_recebido, venda_id")
        .in("venda_id", vendaIds)
        .limit(10000);
      if (errPag) throw errPag;

      // 2.1) Buscar lançamentos financeiros vinculados a essas vendas
      // (para saber quanto de iFood/Fiado/Outros já foi efetivamente recebido)
      const { data: lancsVinc, error: errLanc } = await supabase
        .from("financeiro_lancamentos")
        .select("venda_id, forma_pagamento, valor, valor_pago, status, conciliado_em")
        .in("venda_id", vendaIds)
        .eq("tipo", "receber")
        .limit(20000);
      if (errLanc) throw errLanc;

      // Mapa: (venda_id|forma) -> { recebido, total }
      const lancMap = new Map<string, { recebido: number; total: number }>();
      for (const l of lancsVinc ?? []) {
        if (!l.venda_id || !l.forma_pagamento) continue;
        const key = `${l.venda_id}|${l.forma_pagamento}`;
        const cur = lancMap.get(key) ?? { recebido: 0, total: 0 };
        const valor = Number(l.valor) || 0;
        const pago = Number(l.valor_pago) || 0;
        cur.total += valor;
        // Considera recebido se status pago/recebido OU iFood conciliado.
        // Quando efetivado, o valor cheio do lançamento conta como recebido —
        // a diferença entre valor e valor_pago é taxa (iFood), não pendência.
        const efetivado = l.status === "pago" || l.status === "recebido" || !!l.conciliado_em;
        cur.recebido += efetivado ? valor : pago;
        lancMap.set(key, cur);
      }

      const totals = new Map<string, { recebido: number; aReceber: number }>();
      for (const r of pagamentos ?? []) {
        const venda = vendaMap.get(r.venda_id);
        if (!venda) continue;
        const forma = r.forma_pagamento;
        const cur = totals.get(forma) ?? { recebido: 0, aReceber: 0 };
        const valorBruto = Number(r.valor) || 0;

        // Para iFood/Fiado/Outro: usar lançamento financeiro como fonte da verdade
        // (esses são "a receber" e podem ser quitados depois)
        if (forma === "ifood" || forma === "fiado" || forma === "outro") {
          const key = `${r.venda_id}|${forma}`;
          const lanc = lancMap.get(key);
          if (lanc) {
            // Proporcional caso haja múltiplos pagamentos com a mesma forma
            const recLanc = Math.min(lanc.recebido, valorBruto);
            cur.recebido += recLanc;
            cur.aReceber += Math.max(valorBruto - recLanc, 0);
          } else {
            // Sem lançamento -> ainda não recebido
            cur.aReceber += valorBruto;
          }
        } else {
          // Dinheiro / PIX / Cartão: já entram como recebido conforme status da venda
          const recebido =
            venda.status_pagamento === "pago"
              ? valorBruto
              : venda.status_pagamento === "parcial"
                ? Number(r.valor_recebido ?? 0)
                : 0;
          cur.recebido += recebido;
          cur.aReceber += valorBruto - recebido;
        }
        totals.set(forma, cur);
      }
      return Array.from(totals.entries())
        .map(([forma, v]) => ({ forma, ...v }))
        .filter((e) => e.recebido > 0 || e.aReceber > 0)
        .sort((a, b) => b.recebido + b.aReceber - (a.recebido + a.aReceber));
    },
    staleTime: 15_000,
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["financeiro", "fluxo-caixa", inicio, fim],
    queryFn: async (): Promise<FluxoRow[]> => {
      // Range em timestamp para cobrir o dia inteiro do "fim".
      const inicioTs = `${inicio}T00:00:00`;
      const fimTs = `${fim}T23:59:59.999`;

      // 1) Movimentos do caixa (abertura, sangria, suprimento, fechamento, venda)
      const { data: movs, error: errMovs } = await supabase
        .from("caixa_movimentos")
        .select("id, tipo, valor, motivo, created_at, caixa_id, venda_id")
        .gte("created_at", inicioTs)
        .lte("created_at", fimTs)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (errMovs) throw errMovs;

      const movRows: FluxoRow[] = (movs ?? []).map(
        (m: {
          id: string;
          tipo: string;
          valor: number;
          motivo: string | null;
          created_at: string;
        }) => {
          const tipo = m.tipo as FluxoTipo;
          const bruto = Number(m.valor) || 0;
          // Sinal: entrada (+) ou saída (-)
          let valor = bruto;
          if (tipo === "sangria" || tipo === "fechamento") valor = -Math.abs(bruto);
          else valor = Math.abs(bruto);
          // Abertura e fechamento são movimentos OPERACIONAIS do caixa
          // (fundo de troco / encerramento) — não são receita/despesa real.
          // Mantemos a linha no extrato com valor informativo, mas eles não
          // entram no cálculo de entradas, saídas, saldo do período nem no
          // saldo acumulado real.
          const operacional = tipo === "abertura" || tipo === "fechamento";
          return {
            id: `mov-${m.id}`,
            data: m.created_at,
            tipo,
            origem: "caixa",
            descricao: m.motivo ?? TIPO_LABEL[tipo] ?? "Movimento de caixa",
            valor,
            operacional,
          };
        },
      );

      // 2) Lançamentos financeiros pagos/recebidos NÃO vinculados a caixa
      //    (evita duplicar vendas que já entram via caixa_movimentos).
      const { data: lancs, error: errLancs } = await supabase
        .from("financeiro_lancamentos")
        .select(
          "id, descricao, tipo, valor, valor_pago, data_pagamento, status, caixa_id, venda_id",
        )
        .in("status", ["pago", "recebido"])
        .is("caixa_id", null)
        .is("venda_id", null)
        .gte("data_pagamento", inicio)
        .lte("data_pagamento", fim)
        .order("data_pagamento", { ascending: false })
        .limit(2000);
      if (errLancs) throw errLancs;

      type LancRowDb = {
        id: string;
        descricao: string;
        tipo: "receber" | "pagar" | "receita" | "despesa";
        valor: number;
        valor_pago: number | null;
        data_pagamento: string | null;
        status: string;
      };
      const lancRows: FluxoRow[] = ((lancs ?? []) as LancRowDb[]).map((l) => {
        const v = Number(l.valor_pago ?? l.valor) || 0;
        const isReceita = l.tipo === "receber" || l.tipo === "receita";
        return {
          id: `lanc-${l.id}`,
          data: l.data_pagamento ?? `${inicio}T00:00:00`,
          tipo: isReceita ? "receita" : "despesa",
          origem: "financeiro",
          descricao: l.descricao,
          valor: isReceita ? Math.abs(v) : -Math.abs(v),
          status: l.status,
        };
      });

      const all = [...movRows, ...lancRows].sort((a, b) =>
        a.data < b.data ? 1 : a.data > b.data ? -1 : 0,
      );
      return all;
    },
    staleTime: 15_000,
  });

  const totais = useMemo(() => {
    let entradas = 0;
    let saidas = 0;
    let fundoAberturas = 0; // valor inicial colocado nos caixas (operacional)
    for (const r of rows) {
      if (r.operacional) {
        // Apenas soma o valor das aberturas para exibir como "Fundo de caixa".
        // Fechamento é informativo e não entra em nenhum total.
        if (r.tipo === "abertura") fundoAberturas += Math.abs(r.valor);
        continue;
      }
      if (r.valor >= 0) entradas += r.valor;
      else saidas += Math.abs(r.valor);
    }
    return { entradas, saidas, saldo: entradas - saidas, fundoAberturas };
  }, [rows]);

  // Saldo acumulado REAL (financeiro): ignora abertura e fechamento.
  // Reflete apenas entradas e saídas reais do período.
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

  const [conciliarLoteOpen, setConciliarLoteOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="text-sm text-muted-foreground">
          Consolida movimentos do <strong>Caixa/Operacional</strong> e lançamentos do{" "}
          <strong>Financeiro</strong> sem duplicar vendas já registradas no caixa.
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Entradas reais"
          value={formatBRL(totais.entradas)}
          icon={ArrowDownToLine}
          iconTone="success"
          hint="Vendas, suprimento de caixa e recebimentos"
        />
        <StatCard
          label="Saídas reais"
          value={formatBRL(totais.saidas)}
          icon={ArrowUpFromLine}
          iconTone="warning"
          hint="Sangria de caixa e despesas pagas"
        />
        <StatCard
          label="Resultado do período"
          value={formatBRL(totais.saldo)}
          icon={TrendingUp}
          iconTone={totais.saldo >= 0 ? "success" : "danger"}
          hint="Entradas − Saídas (sem fundo)"
        />
        <StatCard
          label="Fundo de caixa"
          value={formatBRL(totais.fundoAberturas)}
          icon={Wallet}
          iconTone="info"
          hint="Aberturas — operacional, não é receita"
        />
      </div>

      <div className="rounded-md border border-dashed border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
        <strong className="text-foreground">Como ler:</strong> abertura e fechamento de caixa são{" "}
        <em>movimentos operacionais</em> (fundo de troco / encerramento). Eles aparecem no extrato
        como referência, mas <strong>não entram</strong> nas entradas, saídas, resultado nem no
        saldo acumulado real do período.
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
                    Nenhuma movimentação no período selecionado.
                  </TableCell>
                </TableRow>
              ) : (
                rowsComSaldo.map((r) => (
                  <TableRow key={r.id} className={cn(r.operacional && "bg-muted/30")}>
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
                        {TIPO_LABEL[r.tipo]}
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
                      <span
                        className={cn(
                          "rounded-md px-2 py-0.5 text-xs",
                          r.origem === "caixa"
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {r.origem === "caixa" ? "Caixa" : "Financeiro"}
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

      <ConciliarIfoodDialog
        open={conciliarLoteOpen}
        onOpenChange={setConciliarLoteOpen}
        mode="lote"
      />
    </div>
  );
}
