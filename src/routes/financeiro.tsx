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
import {
  BlocoDetalheDialog,
  type DetalheColumn,
  type DetalheRow,
} from "@/components/financeiro/BlocoDetalheDialog";
import { useFinanceiroIndicadores } from "@/hooks/useFinanceiroIndicadores";
import {
  exportarBlocoCSV,
  exportarBlocoPDF,
} from "@/lib/export-bloco";


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

function FinanceContent() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const activeTab: FinTab = tab ?? "receber";
  const [selected, setSelected] = useState<Lancamento | null>(null);

  const { data: lancamentos = [], isLoading } = useQuery({
    queryKey: ["financeiro_lancamentos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financeiro_lancamentos")
        .select(
          `id, descricao, valor, valor_pago, data_vencimento, data_pagamento, data_emissao,
           tipo, status, observacoes, numero_documento, forma_pagamento, created_at,
           conciliado_em, valor_repasse, taxa_repasse, numero_repasse, observacao_repasse,
           fornecedor:fornecedores(razao_social, nome_fantasia),
           cliente:clientes(nome),
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
        fornecedor: { razao_social: string | null; nome_fantasia: string | null } | null;
        cliente: { nome: string | null } | null;
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
        fornecedor_nome: r.fornecedor?.nome_fantasia ?? r.fornecedor?.razao_social ?? null,
        cliente_nome: r.cliente?.nome ?? null,
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financeiro"
        description="Acompanhe entradas, saídas e o fluxo de caixa."
        actions={
          <Button size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            Novo lançamento
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Total a receber"
          value={formatBRL(totalRec)}
          icon={ArrowDownToLine}
          iconTone="success"
          hint={`${receber.length} títulos`}
        />
        <StatCard
          label="Total a pagar"
          value={formatBRL(totalPay)}
          icon={ArrowUpFromLine}
          iconTone="warning"
          hint={`${pagar.length} títulos`}
        />
        <StatCard
          label="Saldo previsto"
          value={formatBRL(saldo)}
          icon={TrendingUp}
          iconTone={saldo >= 0 ? "success" : "danger"}
        />
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
    </div>
  );
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
                  className={onSelect ? "cursor-pointer transition-colors hover:bg-muted/50" : undefined}
                >
                  <TableCell className="font-medium">{i.descricao}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(i.data_vencimento)}</TableCell>
                  <TableCell className="text-right font-medium">{formatBRL(Number(i.valor))}</TableCell>
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
  sangria: "Sangria",
  suprimento: "Suprimento",
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
      const vendaMap = new Map(
        (vendasData ?? []).map((v) => [v.id, v] as const),
      );

      // 2) Buscar pagamentos dessas vendas
      const { data: pagamentos, error: errPag } = await supabase
        .from("venda_pagamentos")
        .select("forma_pagamento, valor, valor_recebido, venda_id")
        .in("venda_id", vendaIds)
        .limit(10000);
      if (errPag) throw errPag;

      const totals = new Map<string, { recebido: number; aReceber: number }>();
      for (const r of pagamentos ?? []) {
        const venda = vendaMap.get(r.venda_id);
        if (!venda) continue;
        const forma = r.forma_pagamento;
        const cur = totals.get(forma) ?? { recebido: 0, aReceber: 0 };
        const valorBruto = Number(r.valor) || 0;
        const recebido =
          venda.status_pagamento === "pago"
            ? valorBruto
            : venda.status_pagamento === "parcial"
              ? Number(r.valor_recebido ?? 0)
              : 0;
        // iFood/Fiado nunca contam como "recebido imediato"
        if (forma === "ifood" || forma === "fiado") {
          cur.aReceber += valorBruto;
        } else {
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

      const movRows: FluxoRow[] = (movs ?? []).map((m: {
        id: string;
        tipo: string;
        valor: number;
        motivo: string | null;
        created_at: string;
      }) => {
        const tipo = m.tipo as FluxoTipo;
        // Sinal: entrada (+) ou saída (-)
        let valor = Number(m.valor) || 0;
        if (tipo === "sangria" || tipo === "fechamento") valor = -Math.abs(valor);
        else valor = Math.abs(valor);
        // "fechamento" entra com valor 0 normalmente — manter informativo.
        return {
          id: `mov-${m.id}`,
          data: m.created_at,
          tipo,
          origem: "caixa",
          descricao: m.motivo ?? TIPO_LABEL[tipo] ?? "Movimento de caixa",
          valor,
        };
      });

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
    for (const r of rows) {
      if (r.tipo === "fechamento") continue; // informativo
      if (r.valor >= 0) entradas += r.valor;
      else saidas += Math.abs(r.valor);
    }
    return { entradas, saidas, saldo: entradas - saidas };
  }, [rows]);

  // Saldo acumulado (a partir do mais antigo).
  const rowsComSaldo = useMemo(() => {
    const ordenadas = [...rows].sort((a, b) => (a.data < b.data ? -1 : 1));
    let acc = 0;
    const map = new Map<string, number>();
    for (const r of ordenadas) {
      if (r.tipo !== "fechamento") acc += r.valor;
      map.set(r.id, acc);
    }
    return rows.map((r) => ({ ...r, saldoAcumulado: map.get(r.id) ?? 0 }));
  }, [rows]);

  const [conciliarLoteOpen, setConciliarLoteOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="text-sm text-muted-foreground">
          Consolida movimentos do <strong>Caixa/Operacional</strong> e lançamentos
          do <strong>Financeiro</strong> sem duplicar vendas já registradas no caixa.
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
          label="Entradas no período"
          value={formatBRL(totais.entradas)}
          icon={ArrowDownToLine}
          iconTone="success"
        />
        <StatCard
          label="Saídas no período"
          value={formatBRL(totais.saidas)}
          icon={ArrowUpFromLine}
          iconTone="warning"
        />
        <StatCard
          label="Saldo do período"
          value={formatBRL(totais.saldo)}
          icon={TrendingUp}
          iconTone={totais.saldo >= 0 ? "success" : "danger"}
        />
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
                <div
                  key={p.forma}
                  className="rounded-md border border-border bg-card/40 p-3"
                >
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
                  <TableRow key={r.id}>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(r.data)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal">
                        {TIPO_LABEL[r.tipo]}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{r.descricao}</TableCell>
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
                        "text-right font-medium",
                        r.valor > 0 && "text-success",
                        r.valor < 0 && "text-destructive",
                      )}
                    >
                      {r.valor === 0 ? "—" : formatBRL(r.valor)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
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
