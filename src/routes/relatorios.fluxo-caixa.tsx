import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowDownRight,
  ArrowUpRight,
  Download,
  Filter,
  Loader2,
  PlayCircle,
  RotateCcw,
  Wallet,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { CloudDependencyNotice } from "@/components/shared/CloudDependencyNotice";
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
import { ModuloGate } from "@/components/saas/ModuloGate";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/mock-data";
import { exportRowsToCSV, type CsvColumn } from "@/lib/export-csv";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/relatorios/fluxo-caixa")({
  head: () => ({
    meta: [
      { title: "Fluxo de Caixa - Gestao Pro" },
      {
        name: "description",
        content:
          "Movimentacoes de caixa: aberturas, vendas, sangrias, suprimentos e fechamentos.",
      },
    ],
  }),
  component: () => (
    <ModuloGate chave="relatorios" titulo="Fluxo de Caixa">
      <Conteudo />
    </ModuloGate>
  ),
});

type PeriodoPreset = "hoje" | "7d" | "30d" | "mes" | "ano" | "personalizado";
type TipoMov = "abertura" | "venda" | "suprimento" | "sangria" | "fechamento";
type FormaKey = "dinheiro" | "pix" | "debito" | "credito" | "boleto" | "ifood" | "fiado" | "outros" | "todas";

interface CaixaSessao {
  id: string;
  operador_id: string | null;
  terminal_id: string | null;
  data_abertura: string;
  data_fechamento: string | null;
  status: string;
  total_dinheiro: number;
  total_pix: number;
  total_debito: number;
  total_credito: number;
  total_boleto: number;
  total_ifood: number;
  total_fiado: number;
  total_outros: number;
  total_vendas: number;
  total_sangrias: number;
  total_suprimentos: number;
  valor_inicial: number;
}

interface MovRow {
  id: string;
  caixa_id: string;
  tipo: TipoMov;
  valor: number;
  motivo: string | null;
  venda_id: string | null;
  operador_id: string | null;
  terminal_id: string | null;
  created_at: string;
  operador_nome: string;
  terminal_nome: string;
}
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function calcRange(
  p: PeriodoPreset,
  customIni: string,
  customFim: string,
): { iniIso: string; fimIso: string } {
  const hoje = new Date();
  if (p === "personalizado") {
    const ini = customIni
      ? new Date(customIni + "T00:00:00")
      : new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const fim = customFim ? new Date(customFim + "T23:59:59") : hoje;
    return { iniIso: ini.toISOString(), fimIso: fim.toISOString() };
  }
  let ini = new Date(hoje);
  ini.setHours(0, 0, 0, 0);
  if (p === "hoje") {
    // já é hoje 00:00
  } else if (p === "7d") ini.setDate(hoje.getDate() - 6);
  else if (p === "30d") ini.setDate(hoje.getDate() - 29);
  else if (p === "mes") ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  else if (p === "ano") ini = new Date(hoje.getFullYear(), 0, 1);
  const fim = new Date(hoje);
  fim.setHours(23, 59, 59, 999);
  return { iniIso: ini.toISOString(), fimIso: fim.toISOString() };
}

function tipoBadge(t: TipoMov) {
  switch (t) {
    case "abertura":
      return (
        <Badge className="bg-info/15 text-info border-info/30 hover:bg-info/15 capitalize">
          Abertura
        </Badge>
      );
    case "venda":
      return (
        <Badge className="bg-success/15 text-success border-success/30 hover:bg-success/15 capitalize">
          Venda
        </Badge>
      );
    case "suprimento":
      return (
        <Badge className="bg-primary/15 text-primary border-primary/30 hover:bg-primary/15 capitalize">
          Suprimento
        </Badge>
      );
    case "sangria":
      return (
        <Badge className="bg-warning/15 text-warning-foreground border-warning/30 hover:bg-warning/15 capitalize">
          Sangria
        </Badge>
      );
    case "fechamento":
      return (
        <Badge variant="outline" className="capitalize text-muted-foreground">
          Fechamento
        </Badge>
      );
  }
}

/** Sinal do movimento sobre o saldo do caixa. */
function sinal(t: TipoMov): 1 | -1 | 0 {
  if (t === "venda" || t === "suprimento" || t === "abertura") return 1;
  if (t === "sangria") return -1;
  return 0; // fechamento
}

function Conteudo() {
  const navigate = useNavigate();

  // ---- Filtros (rascunho) ----
  const [periodo, setPeriodo] = useState<PeriodoPreset>("30d");
  const [customIni, setCustomIni] = useState("");
  const [customFim, setCustomFim] = useState("");
  const [operador, setOperador] = useState<string>("todos");
  const [terminal, setTerminal] = useState<string>("todos");
  const [caixaSel, setCaixaSel] = useState<string>("todos");
  const [forma, setForma] = useState<FormaKey>("todas");
  const [tipoFiltro, setTipoFiltro] = useState<"todos" | TipoMov>("todos");

  // Filtros aplicados (só os que disparam refetch)
  const [aplicado, setAplicado] = useState({
    periodo,
    customIni,
    customFim,
    operador,
    terminal,
    caixaSel,
  });

  // ---- Dados base ----
  const [operadores, setOperadores] = useState<{ id: string; nome: string }[]>([]);
  const [terminais, setTerminais] = useState<{ id: string; nome: string }[]>([]);
  const [caixas, setCaixas] = useState<CaixaSessao[]>([]);
  const [movs, setMovs] = useState<MovRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Lookups operadores + terminais (uma vez)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: funcs }, { data: terms }] = await Promise.all([
        supabase.from("funcionarios").select("id, nome").eq("ativo", true).order("nome"),
        supabase.from("terminais").select("id, nome").eq("ativo", true).order("nome"),
      ]);
      if (cancelled) return;
      setOperadores((funcs ?? []) as { id: string; nome: string }[]);
      setTerminais((terms ?? []) as { id: string; nome: string }[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Carrega caixas + movimentos do período aplicado
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLocalError(null);
      const { iniIso, fimIso } = calcRange(
        aplicado.periodo,
        aplicado.customIni,
        aplicado.customFim,
      );

      // Sessões de caixa abertas no período
      let qc = supabase
        .from("caixas")
        .select(
          "id, data_abertura, data_fechamento, operador_id, terminal_id, status, total_dinheiro, total_pix, total_debito, total_credito, total_boleto, total_ifood, total_fiado, total_outros, total_vendas, total_sangrias, total_suprimentos, valor_inicial",
        )
        .gte("data_abertura", iniIso)
        .lte("data_abertura", fimIso)
        .order("data_abertura", { ascending: false })
        .limit(500);
      if (aplicado.operador !== "todos") qc = qc.eq("operador_id", aplicado.operador);
      if (aplicado.terminal !== "todos") qc = qc.eq("terminal_id", aplicado.terminal);
      if (aplicado.caixaSel !== "todos") qc = qc.eq("id", aplicado.caixaSel);

      const { data: cxs, error: cxErr } = await qc;
      if (cancelled) return;
      if (cxErr) {
        toast.error(cxErr.message);
        setCaixas([]);
        setMovs([]);
        setLoading(false);
        return;
      }

      const caixaList = (cxs ?? []).map((c: any) => ({
        id: c.id,
        data_abertura: c.data_abertura,
        data_fechamento: c.data_fechamento,
        operador_id: c.operador_id,
        terminal_id: c.terminal_id,
        status: c.status,
        total_dinheiro: Number(c.total_dinheiro) || 0,
        total_pix: Number(c.total_pix) || 0,
        total_debito: Number(c.total_debito) || 0,
        total_credito: Number(c.total_credito) || 0,
        total_boleto: Number(c.total_boleto) || 0,
        total_ifood: Number(c.total_ifood) || 0,
        total_fiado: Number(c.total_fiado) || 0,
        total_outros: Number(c.total_outros) || 0,
        total_vendas: Number(c.total_vendas) || 0,
        total_sangrias: Number(c.total_sangrias) || 0,
        total_suprimentos: Number(c.total_suprimentos) || 0,
        valor_inicial: Number(c.valor_inicial) || 0,
      })) as CaixaSessao[];
      setCaixas(caixaList);

      // Movimentos do(s) caixa(s) do período
      const ids = caixaList.map((c) => c.id);
      if (ids.length === 0) {
        setMovs([]);
        setLoading(false);
        return;
      }

      const { data: mv, error: mvErr } = await supabase
        .from("caixa_movimentos")
        .select(
          "id, caixa_id, tipo, valor, motivo, venda_id, operador_id, terminal_id, created_at",
        )
        .in("caixa_id", ids)
        .order("created_at", { ascending: false })
        .limit(5000);

      if (cancelled) return;
      if (mvErr) {
        toast.error(mvErr.message);
        setMovs([]);
        setLoading(false);
        return;
      }

      const opMap = new Map(operadores.map((o) => [o.id, o.nome]));
      const tMap = new Map(terminais.map((t) => [t.id, t.nome]));
      const cxMap = new Map(caixaList.map((c) => [c.id, c]));

      const mapped: MovRow[] = (mv ?? []).map((m: any) => {
        const cx = cxMap.get(m.caixa_id);
        const opId = m.operador_id ?? cx?.operador_id ?? null;
        const tId = m.terminal_id ?? cx?.terminal_id ?? null;
        return {
          id: m.id,
          caixa_id: m.caixa_id,
          tipo: m.tipo as TipoMov,
          valor: Number(m.valor) || 0,
          motivo: m.motivo ?? null,
          venda_id: m.venda_id ?? null,
          operador_id: opId,
          terminal_id: tId,
          created_at: m.created_at,
          operador_nome: (opId && opMap.get(opId)) || "—",
          terminal_nome: (tId && tMap.get(tId)) || "—",
        };
      });
      setMovs(mapped);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [aplicado, operadores, terminais]);

  // Filtros client-side (tipo)
  const movsFiltrados = useMemo(() => {
    return movs.filter((m) => {
      if (tipoFiltro !== "todos" && m.tipo !== tipoFiltro) return false;
      return true;
    });
  }, [movs, tipoFiltro]);

  // Totais entradas/saídas/saldo
  const totais = useMemo(() => {
    let entradas = 0;
    let saidas = 0;
    let qtdSangrias = 0;
    let qtdSuprimentos = 0;
    let qtdVendas = 0;
    let qtdAberturas = 0;
    let qtdFechamentos = 0;
    for (const m of movsFiltrados) {
      const s = sinal(m.tipo);
      if (s > 0) entradas += m.valor;
      else if (s < 0) saidas += m.valor;
      if (m.tipo === "sangria") qtdSangrias++;
      if (m.tipo === "suprimento") qtdSuprimentos++;
      if (m.tipo === "venda") qtdVendas++;
      if (m.tipo === "abertura") qtdAberturas++;
      if (m.tipo === "fechamento") qtdFechamentos++;
    }
    return {
      entradas,
      saidas,
      saldo: entradas - saidas,
      qtdSangrias,
      qtdSuprimentos,
      qtdVendas,
      qtdAberturas,
      qtdFechamentos,
    };
  }, [movsFiltrados]);

  // Resumo por dia (saldo diário)
  const porDia = useMemo(() => {
    const map = new Map<
      string,
      { dia: string; entradas: number; saidas: number; saldo: number; qtd: number }
    >();
    for (const m of movsFiltrados) {
      const dia = m.created_at.slice(0, 10);
      const cur = map.get(dia) ?? { dia, entradas: 0, saidas: 0, saldo: 0, qtd: 0 };
      const s = sinal(m.tipo);
      if (s > 0) cur.entradas += m.valor;
      else if (s < 0) cur.saidas += m.valor;
      cur.saldo = cur.entradas - cur.saidas;
      cur.qtd++;
      map.set(dia, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.dia.localeCompare(a.dia));
  }, [movsFiltrados]);

  // Formas de pagamento (somadas das caixas filtradas)
  const formasPagamento = useMemo(() => {
    const acc = {
      dinheiro: 0,
      pix: 0,
      debito: 0,
      credito: 0,
      boleto: 0,
      ifood: 0,
      fiado: 0,
      outros: 0,
    };
    for (const c of caixas) {
      acc.dinheiro += c.total_dinheiro;
      acc.pix += c.total_pix;
      acc.debito += c.total_debito;
      acc.credito += c.total_credito;
      acc.boleto += c.total_boleto;
      acc.ifood += c.total_ifood;
      acc.fiado += c.total_fiado;
      acc.outros += c.total_outros;
    }
    return acc;
  }, [caixas]);

  const formasList = useMemo(() => {
    const items: { key: FormaKey; label: string; valor: number }[] = [
      { key: "dinheiro", label: "Dinheiro", valor: formasPagamento.dinheiro },
      { key: "pix", label: "PIX", valor: formasPagamento.pix },
      { key: "debito", label: "Débito", valor: formasPagamento.debito },
      { key: "credito", label: "Crédito", valor: formasPagamento.credito },
      { key: "boleto", label: "Boleto", valor: formasPagamento.boleto },
      { key: "ifood", label: "iFood", valor: formasPagamento.ifood },
      { key: "fiado", label: "Fiado", valor: formasPagamento.fiado },
      { key: "outros", label: "Outros", valor: formasPagamento.outros },
    ];
    if (forma !== "todas") return items.filter((i) => i.key === forma);
    return items.filter((i) => i.valor > 0);
  }, [formasPagamento, forma]);

  // Lista de sessões para o filtro "caixa"
  const caixasSelect = useMemo(() => {
    return caixas.map((c) => {
      const op = operadores.find((o) => o.id === c.operador_id)?.nome ?? "—";
      const t = terminais.find((t) => t.id === c.terminal_id)?.nome ?? "—";
      const data = new Date(c.data_abertura).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      return { id: c.id, label: `${data} — ${op} / ${t}` };
    });
  }, [caixas, operadores, terminais]);

  function aplicar() {
    setAplicado({ periodo, customIni, customFim, operador, terminal, caixaSel });
  }

  function limpar() {
    setPeriodo("30d");
    setCustomIni("");
    setCustomFim("");
    setOperador("todos");
    setTerminal("todos");
    setCaixaSel("todos");
    setForma("todas");
    setTipoFiltro("todos");
    setAplicado({
      periodo: "30d",
      customIni: "",
      customFim: "",
      operador: "todos",
      terminal: "todos",
      caixaSel: "todos",
    });
  }

  async function handleExport() {
    if (movsFiltrados.length === 0) {
      toast.warning("Sem movimentações para exportar.");
      return;
    }
    setExporting(true);
    toast.loading("Gerando relatório...", { id: "export-fluxo" });
    try {
      const cols: CsvColumn<MovRow>[] = [
        { header: "Data/Hora", accessor: (r) => r.created_at, type: "datetime" },
        { header: "Tipo", accessor: (r) => r.tipo, type: "text" },
        { header: "Operador", accessor: (r) => r.operador_nome, type: "text" },
        { header: "Terminal", accessor: (r) => r.terminal_nome, type: "text" },
        { header: "Motivo", accessor: (r) => r.motivo ?? "", type: "text" },
        {
          header: "Valor",
          accessor: (r) => (sinal(r.tipo) < 0 ? -r.valor : r.valor),
          type: "currency",
        },
        { header: "Caixa ID", accessor: (r) => r.caixa_id, type: "text" },
      ];
      exportRowsToCSV("fluxo-caixa", movsFiltrados, cols);
      toast.success("Download iniciado", { id: "export-fluxo" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha", { id: "export-fluxo" });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <CloudDependencyNotice />
      <PageHeader
        title="Fluxo de Caixa"
        description="Movimentações reais do caixa: aberturas, vendas, sangrias, suprimentos e fechamentos."
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
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            <div>
              <Label className="text-xs">Período</Label>
              <Select value={periodo} onValueChange={(v) => setPeriodo(v as PeriodoPreset)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hoje">Hoje</SelectItem>
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
              <Label className="text-xs">Operador</Label>
              <Select value={operador} onValueChange={setOperador}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os operadores</SelectItem>
                  {operadores.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Terminal</Label>
              <Select value={terminal} onValueChange={setTerminal}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os terminais</SelectItem>
                  {terminais.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Caixa (sessão)</Label>
              <Select value={caixaSel} onValueChange={setCaixaSel}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todas as sessões</SelectItem>
                  {caixasSelect.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Forma de pagamento</Label>
              <Select value={forma} onValueChange={(v) => setForma(v as FormaKey)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  <SelectItem value="dinheiro">Dinheiro</SelectItem>
                  <SelectItem value="pix">PIX</SelectItem>
                  <SelectItem value="debito">Débito</SelectItem>
                  <SelectItem value="credito">Crédito</SelectItem>
                  <SelectItem value="boleto">Boleto</SelectItem>
                  <SelectItem value="ifood">iFood</SelectItem>
                  <SelectItem value="fiado">Fiado</SelectItem>
                  <SelectItem value="outros">Outros</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Tipo de movimento</Label>
              <Select
                value={tipoFiltro}
                onValueChange={(v) => setTipoFiltro(v as "todos" | TipoMov)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="abertura">Aberturas</SelectItem>
                  <SelectItem value="venda">Vendas</SelectItem>
                  <SelectItem value="suprimento">Suprimentos</SelectItem>
                  <SelectItem value="sangria">Sangrias</SelectItem>
                  <SelectItem value="fechamento">Fechamentos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button size="sm" className="gap-1.5" onClick={aplicar}>
              <Filter className="h-4 w-4" /> Aplicar
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={limpar}>
              <RotateCcw className="h-4 w-4" /> Limpar
            </Button>
          </div>
        </CardContent>
      </Card>

      {localError && (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            Dados locais de fluxo de caixa indisponiveis: {localError}
          </CardContent>
        </Card>
      )}

      {/* ---- Totais ---- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Entradas"
          value={formatBRL(totais.entradas)}
          icon={ArrowUpRight}
          iconTone="success"
          hint={`${totais.qtdVendas} vendas, ${totais.qtdSuprimentos} supr., ${totais.qtdAberturas} abert.`}
        />
        <StatCard
          label="Saídas"
          value={formatBRL(totais.saidas)}
          icon={ArrowDownRight}
          iconTone="warning"
          hint={`${totais.qtdSangrias} sangrias`}
        />
        <StatCard
          label="Saldo do período"
          value={formatBRL(totais.saldo)}
          icon={Wallet}
          iconTone={totais.saldo >= 0 ? "primary" : "warning"}
        />
        <StatCard
          label="Sessões de caixa"
          value={String(caixas.length)}
          icon={PlayCircle}
          iconTone="info"
          hint={`${totais.qtdFechamentos} fechamentos`}
        />
      </div>

      {/* ---- Formas de pagamento ---- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Vendas por forma de pagamento</CardTitle>
        </CardHeader>
        <CardContent>
          {formasList.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem vendas no período.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {formasList.map((f) => (
                <div
                  key={f.key}
                  className="rounded-lg border border-border bg-muted/30 p-3"
                >
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {f.label}
                  </p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {formatBRL(f.valor)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- Resumo diário ---- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Resumo diário</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {porDia.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Sem movimentações no período.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dia</TableHead>
                  <TableHead className="text-right">Entradas</TableHead>
                  <TableHead className="text-right">Saídas</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="text-right">Movs.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {porDia.map((d) => (
                  <TableRow key={d.dia}>
                    <TableCell className="font-medium">
                      {new Date(d.dia + "T00:00:00").toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-success">
                      {formatBRL(d.entradas)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-destructive">
                      {formatBRL(d.saidas)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-medium tabular-nums",
                        d.saldo < 0 && "text-destructive",
                      )}
                    >
                      {formatBRL(d.saldo)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {d.qtd}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ---- Movimentações detalhadas ---- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Movimentações</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : movsFiltrados.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-1 text-muted-foreground">
              <XCircle className="h-8 w-8 opacity-40" />
              <p className="font-medium">Nenhuma movimentação no período</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data/Hora</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Operador</TableHead>
                  <TableHead>Terminal</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movsFiltrados.slice(0, 500).map((m) => {
                  const s = sinal(m.tipo);
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="text-muted-foreground">
                        {new Date(m.created_at).toLocaleString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>
                      <TableCell>{tipoBadge(m.tipo)}</TableCell>
                      <TableCell>{m.operador_nome}</TableCell>
                      <TableCell>{m.terminal_nome}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {m.motivo ?? "—"}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-medium tabular-nums",
                          s > 0 && "text-success",
                          s < 0 && "text-destructive",
                        )}
                      >
                        {s < 0 ? "-" : s > 0 ? "+" : ""}
                        {formatBRL(m.valor)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {movsFiltrados.length > 500 && (
            <p className="border-t border-border p-2 text-center text-xs text-muted-foreground">
              Exibindo as 500 movimentações mais recentes. Use os filtros para refinar.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
