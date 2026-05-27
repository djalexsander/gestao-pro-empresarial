import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Download,
  Loader2,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
  Filter,
  RefreshCw,
  Eye,
  CircleDollarSign,
  Banknote,
  CreditCard,
  Smartphone,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { CloudDependencyNotice } from "@/components/shared/CloudDependencyNotice";
import { StatCard } from "@/components/shared/StatCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ModuloGate } from "@/components/saas/ModuloGate";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/mock-data";
import { exportRowsToCSV, type CsvColumn } from "@/lib/export-csv";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/relatorios/caixa")({
  head: () => ({
    meta: [
      { title: "Relatório de Caixa — Gestão Pro" },
      { name: "description", content: "Aberturas, movimentações e fechamentos de caixa." },
    ],
  }),
  component: () => (
    <ModuloGate chave="relatorios" titulo="Relatório de Caixa">
      <Conteudo />
    </ModuloGate>
  ),
});

/* =========================================================
 * Tipos
 * =======================================================*/
type PeriodoChave = "hoje" | "ontem" | "7d" | "30d" | "custom";
type StatusFiltro = "todos" | "aberto" | "fechado" | "divergencia";

interface CaixaRow {
  id: string;
  operador_id: string | null;
  operador_nome: string;
  terminal_id: string | null;
  terminal_nome: string;
  data_abertura: string;
  data_fechamento: string | null;
  valor_inicial: number;
  total_vendas: number;
  total_sangrias: number;
  total_suprimentos: number;
  total_dinheiro: number;
  total_pix: number;
  total_debito: number;
  total_credito: number;
  total_boleto: number;
  total_ifood: number;
  total_fiado: number;
  total_outros: number;
  valor_esperado: number | null;
  valor_informado: number | null;
  diferenca: number | null;
  status: "aberto" | "fechado";
  observacao: string | null;
  observacao_fechamento: string | null;
  qtd_vendas: number;
}

interface MovimentoRow {
  id: string;
  caixa_id: string;
  tipo: string;
  valor: number;
  motivo: string | null;
  created_at: string;
}

/* =========================================================
 * Helpers de data e formato
 * =======================================================*/
function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
function calcRange(p: PeriodoChave, customIni?: string, customFim?: string) {
  const today = new Date();
  if (p === "hoje") {
    return { ini: startOfDay(today), fim: endOfDay(today) };
  }
  if (p === "ontem") {
    const o = new Date(today);
    o.setDate(today.getDate() - 1);
    return { ini: startOfDay(o), fim: endOfDay(o) };
  }
  if (p === "7d") {
    const i = new Date(today);
    i.setDate(today.getDate() - 6);
    return { ini: startOfDay(i), fim: endOfDay(today) };
  }
  if (p === "30d") {
    const i = new Date(today);
    i.setDate(today.getDate() - 29);
    return { ini: startOfDay(i), fim: endOfDay(today) };
  }
  // custom
  const ini = customIni ? startOfDay(new Date(customIni + "T00:00:00")) : startOfDay(today);
  const fim = customFim ? endOfDay(new Date(customFim + "T00:00:00")) : endOfDay(today);
  return { ini, fim };
}
function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* =========================================================
 * Conteúdo
 * =======================================================*/
function Conteudo() {
  const navigate = useNavigate();

  // Filtros (pendentes — aplicados ao clicar Aplicar)
  const [pPeriodo, setPPeriodo] = useState<PeriodoChave>("hoje");
  const [pCustomIni, setPCustomIni] = useState("");
  const [pCustomFim, setPCustomFim] = useState("");
  const [pOperador, setPOperador] = useState<string>("todos");
  const [pTerminal, setPTerminal] = useState<string>("todos");
  const [pStatus, setPStatus] = useState<StatusFiltro>("todos");

  // Filtros aplicados (efetivamente em uso)
  const [filtros, setFiltros] = useState({
    periodo: "hoje" as PeriodoChave,
    customIni: "",
    customFim: "",
    operador: "todos",
    terminal: "todos",
    status: "todos" as StatusFiltro,
  });

  const [rows, setRows] = useState<CaixaRow[]>([]);
  const [operadores, setOperadores] = useState<{ id: string; nome: string }[]>([]);
  const [terminais, setTerminais] = useState<{ id: string; nome: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [detalhe, setDetalhe] = useState<CaixaRow | null>(null);

  // Carrega operadores e terminais (uma vez)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: funcs }, { data: terms }] = await Promise.all([
        supabase.from("funcionarios").select("id, nome").eq("ativo", true).order("nome"),
        supabase.from("terminais").select("id, nome").eq("ativo", true).order("nome"),
      ]);
      if (cancelled) return;
      setOperadores(funcs ?? []);
      setTerminais(terms ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Carrega caixas conforme filtros aplicados
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { ini, fim } = calcRange(filtros.periodo, filtros.customIni, filtros.customFim);

      let q = supabase
        .from("caixas")
        .select(
          "id, operador_id, terminal_id, data_abertura, data_fechamento, valor_inicial, total_vendas, total_sangrias, total_suprimentos, total_dinheiro, total_pix, total_debito, total_credito, total_boleto, total_ifood, total_fiado, total_outros, valor_esperado, valor_informado, diferenca, status, observacao, observacao_fechamento, qtd_vendas",
        )
        .gte("data_abertura", ini.toISOString())
        .lte("data_abertura", fim.toISOString())
        .order("data_abertura", { ascending: false })
        .limit(500);

      if (filtros.operador !== "todos") q = q.eq("operador_id", filtros.operador);
      if (filtros.terminal !== "todos") q = q.eq("terminal_id", filtros.terminal);
      if (filtros.status === "aberto") q = q.eq("status", "aberto");
      if (filtros.status === "fechado") q = q.eq("status", "fechado");

      const { data, error } = await q;
      if (cancelled) return;
      if (error) {
        toast.error(error.message);
        setRows([]);
        setLoading(false);
        return;
      }

      const opMap = new Map(operadores.map((o) => [o.id, o.nome]));
      const tMap = new Map(terminais.map((t) => [t.id, t.nome]));

      let mapped: CaixaRow[] = (data ?? []).map((c: any) => ({
        id: c.id,
        operador_id: c.operador_id,
        operador_nome: opMap.get(c.operador_id) ?? "—",
        terminal_id: c.terminal_id,
        terminal_nome: tMap.get(c.terminal_id) ?? "—",
        data_abertura: c.data_abertura,
        data_fechamento: c.data_fechamento,
        valor_inicial: Number(c.valor_inicial) || 0,
        total_vendas: Number(c.total_vendas) || 0,
        total_sangrias: Number(c.total_sangrias) || 0,
        total_suprimentos: Number(c.total_suprimentos) || 0,
        total_dinheiro: Number(c.total_dinheiro) || 0,
        total_pix: Number(c.total_pix) || 0,
        total_debito: Number(c.total_debito) || 0,
        total_credito: Number(c.total_credito) || 0,
        total_boleto: Number(c.total_boleto) || 0,
        total_ifood: Number(c.total_ifood) || 0,
        total_fiado: Number(c.total_fiado) || 0,
        total_outros: Number(c.total_outros) || 0,
        valor_esperado: c.valor_esperado != null ? Number(c.valor_esperado) : null,
        valor_informado: c.valor_informado != null ? Number(c.valor_informado) : null,
        diferenca: c.diferenca != null ? Number(c.diferenca) : null,
        status: c.status,
        observacao: c.observacao,
        observacao_fechamento: c.observacao_fechamento,
        qtd_vendas: Number(c.qtd_vendas) || 0,
      }));

      // Filtro de divergência aplicado em memória (somente fechados com diferença != 0)
      if (filtros.status === "divergencia") {
        mapped = mapped.filter(
          (r) => r.status === "fechado" && r.diferenca != null && Math.abs(r.diferenca) > 0.009,
        );
      }

      setRows(mapped);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [filtros, operadores, terminais]);

  /* ---------- Métricas ---------- */
  const metricas = useMemo(() => {
    let saldoFinal = 0;
    let entradas = 0;
    let saidas = 0;
    let divergencia = 0;
    for (const r of rows) {
      // Entradas: vendas + suprimentos + valor inicial
      entradas += r.total_vendas + r.total_suprimentos + r.valor_inicial;
      // Saídas: sangrias
      saidas += r.total_sangrias;
      // Saldo final = valor esperado se já tivermos, senão entradas - saídas
      saldoFinal += r.valor_esperado ?? r.valor_inicial + r.total_vendas + r.total_suprimentos - r.total_sangrias;
      // Divergência total
      if (r.status === "fechado" && r.diferenca != null) {
        divergencia += r.diferenca;
      }
    }
    return { saldoFinal, entradas, saidas, divergencia };
  }, [rows]);

  /* ---------- Ações ---------- */
  function aplicarFiltros() {
    if (pPeriodo === "custom" && (!pCustomIni || !pCustomFim)) {
      toast.warning("Informe as duas datas para o período personalizado.");
      return;
    }
    if (pPeriodo === "custom" && pCustomIni > pCustomFim) {
      toast.warning("A data inicial não pode ser maior que a final.");
      return;
    }
    setFiltros({
      periodo: pPeriodo,
      customIni: pCustomIni,
      customFim: pCustomFim,
      operador: pOperador,
      terminal: pTerminal,
      status: pStatus,
    });
  }
  function limparFiltros() {
    setPPeriodo("hoje");
    setPCustomIni("");
    setPCustomFim("");
    setPOperador("todos");
    setPTerminal("todos");
    setPStatus("todos");
    setFiltros({
      periodo: "hoje",
      customIni: "",
      customFim: "",
      operador: "todos",
      terminal: "todos",
      status: "todos",
    });
  }

  async function handleExport() {
    if (rows.length === 0) {
      toast.warning("Sem dados para exportar.");
      return;
    }
    setExporting(true);
    toast.loading("Gerando relatório...", { id: "export-caixa" });
    try {
      const columns: CsvColumn<CaixaRow>[] = [
        { header: "Operador", accessor: (r) => r.operador_nome, type: "text" },
        { header: "Terminal", accessor: (r) => r.terminal_nome, type: "text" },
        { header: "Abertura", accessor: (r) => r.data_abertura, type: "datetime" },
        { header: "Fechamento", accessor: (r) => r.data_fechamento ?? "", type: "datetime" },
        { header: "Valor inicial", accessor: (r) => r.valor_inicial, type: "currency" },
        { header: "Total vendas", accessor: (r) => r.total_vendas, type: "currency" },
        { header: "Sangria de caixa", accessor: (r) => r.total_sangrias, type: "currency" },
        { header: "Suprimento de caixa", accessor: (r) => r.total_suprimentos, type: "currency" },
        { header: "Dinheiro", accessor: (r) => r.total_dinheiro, type: "currency" },
        { header: "PIX", accessor: (r) => r.total_pix, type: "currency" },
        { header: "Debito", accessor: (r) => r.total_debito, type: "currency" },
        { header: "Credito", accessor: (r) => r.total_credito, type: "currency" },
        { header: "Esperado", accessor: (r) => r.valor_esperado ?? "", type: "currency" },
        { header: "Informado", accessor: (r) => r.valor_informado ?? "", type: "currency" },
        { header: "Diferenca", accessor: (r) => r.diferenca ?? "", type: "currency" },
        { header: "Status", accessor: (r) => r.status, type: "text" },
      ];
      exportRowsToCSV("caixa", rows, columns);
      toast.success("Download iniciado", { id: "export-caixa" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha", { id: "export-caixa" });
    } finally {
      setExporting(false);
    }
  }

  /* =========================================================
   * Render
   * =======================================================*/
  return (
    <div className="space-y-6">
      <CloudDependencyNotice />
      <PageHeader
        title="Relatório de Caixa"
        description="Aberturas, movimentações e fechamentos de caixa."
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
              disabled={exporting || loading}
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
              <Label className="text-xs">Período</Label>
              <Select value={pPeriodo} onValueChange={(v) => setPPeriodo(v as PeriodoChave)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hoje">Hoje</SelectItem>
                  <SelectItem value="ontem">Ontem</SelectItem>
                  <SelectItem value="7d">Últimos 7 dias</SelectItem>
                  <SelectItem value="30d">Últimos 30 dias</SelectItem>
                  <SelectItem value="custom">Personalizado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Operador</Label>
              <Select value={pOperador} onValueChange={setPOperador}>
                <SelectTrigger>
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

            <div className="space-y-1.5">
              <Label className="text-xs">Terminal</Label>
              <Select value={pTerminal} onValueChange={setPTerminal}>
                <SelectTrigger>
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

            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={pStatus} onValueChange={(v) => setPStatus(v as StatusFiltro)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="aberto">Aberto</SelectItem>
                  <SelectItem value="fechado">Fechado</SelectItem>
                  <SelectItem value="divergencia">Com divergência</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {pPeriodo === "custom" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">De</Label>
                <Input type="date" value={pCustomIni} onChange={(e) => setPCustomIni(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Até</Label>
                <Input type="date" value={pCustomFim} onChange={(e) => setPCustomFim(e.target.value)} />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button size="sm" className="gap-1.5" onClick={aplicarFiltros}>
              <Filter className="h-4 w-4" />
              Aplicar filtros
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={limparFiltros}>
              <RefreshCw className="h-4 w-4" />
              Limpar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Métricas */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total em caixa"
          value={formatBRL(metricas.saldoFinal)}
          hint="Saldo esperado das sessões"
          icon={Wallet}
          iconTone="primary"
        />
        <StatCard
          label="Entradas"
          value={formatBRL(metricas.entradas)}
          hint="Valor inicial + vendas + suprimento de caixa"
          icon={ArrowUpRight}
          iconTone="success"
        />
        <StatCard
          label="Saídas"
          value={formatBRL(metricas.saidas)}
          hint="Sangria de caixa"
          icon={ArrowDownRight}
          iconTone="warning"
        />
        <StatCard
          label="Diferença de caixa"
          value={formatBRL(metricas.divergencia)}
          hint={
            Math.abs(metricas.divergencia) < 0.01
              ? "Sem divergência"
              : metricas.divergencia > 0
                ? "Sobra"
                : "Falta"
          }
          icon={AlertTriangle}
          iconTone={Math.abs(metricas.divergencia) < 0.01 ? "primary" : "warning"}
        />
      </div>

      {/* Tabela */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-1 text-muted-foreground">
              <CircleDollarSign className="h-8 w-8 opacity-40" />
              <p className="font-medium">Nenhuma sessão de caixa encontrada</p>
              <p className="text-xs">Ajuste os filtros e tente novamente.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Operador</TableHead>
                    <TableHead>Terminal</TableHead>
                    <TableHead>Abertura</TableHead>
                    <TableHead>Fechamento</TableHead>
                    <TableHead className="text-right">Inicial</TableHead>
                    <TableHead className="text-right">Vendas</TableHead>
                    <TableHead className="text-right">Saídas</TableHead>
                    <TableHead className="text-right">Esperado</TableHead>
                    <TableHead className="text-right">Informado</TableHead>
                    <TableHead className="text-right">Diferença</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[60px] text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const temDivergencia =
                      r.status === "fechado" && r.diferenca != null && Math.abs(r.diferenca) > 0.009;
                    return (
                      <TableRow
                        key={r.id}
                        className={cn(
                          "cursor-pointer",
                          temDivergencia && "bg-destructive/5 hover:bg-destructive/10",
                        )}
                        onClick={() => setDetalhe(r)}
                      >
                        <TableCell className="font-medium">{r.operador_nome}</TableCell>
                        <TableCell className="text-muted-foreground">{r.terminal_nome}</TableCell>
                        <TableCell className="text-muted-foreground tabular-nums">
                          {fmtDateTime(r.data_abertura)}
                        </TableCell>
                        <TableCell className="text-muted-foreground tabular-nums">
                          {fmtDateTime(r.data_fechamento)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatBRL(r.valor_inicial)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatBRL(r.total_vendas)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatBRL(r.total_sangrias)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {r.valor_esperado != null ? formatBRL(r.valor_esperado) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.valor_informado != null ? formatBRL(r.valor_informado) : "—"}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums font-semibold",
                            temDivergencia && "text-destructive",
                          )}
                        >
                          {r.diferenca != null ? formatBRL(r.diferenca) : "—"}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={r.status} divergencia={temDivergencia} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDetalhe(r);
                            }}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <DetalheCaixaDialog
        caixa={detalhe}
        onClose={() => setDetalhe(null)}
        onUpdate={(atual) => {
          setRows((rs) => rs.map((r) => (r.id === atual.id ? atual : r)));
          setDetalhe(atual);
        }}
      />
    </div>
  );
}

/* =========================================================
 * Status badge
 * =======================================================*/
function StatusBadge({
  status,
  divergencia,
}: {
  status: "aberto" | "fechado";
  divergencia: boolean;
}) {
  if (status === "aberto") {
    return (
      <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30">
        Aberto
      </Badge>
    );
  }
  if (divergencia) {
    return (
      <Badge variant="outline" className="bg-destructive/15 text-destructive border-destructive/30">
        Divergência
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="bg-success/15 text-success border-success/30">
      Correto
    </Badge>
  );
}

/* =========================================================
 * Dialog de detalhe (auditoria)
 * =======================================================*/
function DetalheCaixaDialog({
  caixa,
  onClose,
  onUpdate,
}: {
  caixa: CaixaRow | null;
  onClose: () => void;
  onUpdate: (c: CaixaRow) => void;
}) {
  const open = !!caixa;
  const [movs, setMovs] = useState<MovimentoRow[]>([]);
  const [loadingMovs, setLoadingMovs] = useState(false);
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!caixa) return;
    setObs(caixa.observacao_fechamento ?? "");
    let cancelled = false;
    (async () => {
      setLoadingMovs(true);
      const { data, error } = await supabase
        .from("caixa_movimentos")
        .select("id, caixa_id, tipo, valor, motivo, created_at")
        .eq("caixa_id", caixa.id)
        .order("created_at", { ascending: false })
        .limit(500);
      if (cancelled) return;
      if (error) {
        toast.error(error.message);
        setMovs([]);
      } else {
        setMovs(
          (data ?? []).map((m: any) => ({
            id: m.id,
            caixa_id: m.caixa_id,
            tipo: m.tipo,
            valor: Number(m.valor) || 0,
            motivo: m.motivo,
            created_at: m.created_at,
          })),
        );
      }
      setLoadingMovs(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [caixa]);

  async function salvarObservacao() {
    if (!caixa) return;
    setSalvando(true);
    const { error } = await supabase
      .from("caixas")
      .update({ observacao_fechamento: obs.trim() || null })
      .eq("id", caixa.id);
    setSalvando(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Observação salva.");
    onUpdate({ ...caixa, observacao_fechamento: obs.trim() || null });
  }

  if (!caixa) return null;

  const temDivergencia =
    caixa.status === "fechado" && caixa.diferenca != null && Math.abs(caixa.diferenca) > 0.009;

  // Esperado calculado para fallback (caixa aberto ainda não tem valor_esperado)
  const esperadoCalc =
    caixa.valor_esperado ??
    caixa.valor_inicial +
      caixa.total_vendas +
      caixa.total_suprimentos -
      caixa.total_sangrias;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CircleDollarSign className="h-5 w-5 text-primary" />
            Sessão de caixa — {caixa.operador_nome}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {caixa.terminal_nome} · Aberta em {fmtDateTime(caixa.data_abertura)}
            {caixa.data_fechamento ? ` · Fechada em ${fmtDateTime(caixa.data_fechamento)}` : ""}
          </p>
        </DialogHeader>

        {temDivergencia && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-destructive">
                Divergência detectada: {formatBRL(caixa.diferenca!)}
              </p>
              <p className="text-xs text-destructive/80">
                {caixa.diferenca! > 0
                  ? "Sobra de caixa — verificar registros de venda."
                  : "Falta de caixa — verificar pagamentos não registrados ou retiradas."}
              </p>
            </div>
          </div>
        )}

        {/* Resumo financeiro */}
        <div className="grid gap-2 sm:grid-cols-2">
          <ResumoLinha label="Valor inicial (fundo de troco)" value={caixa.valor_inicial} />
          <ResumoLinha label="Total de vendas" value={caixa.total_vendas} positivo />
          <ResumoLinha label="Suprimento de caixa (entrou)" value={caixa.total_suprimentos} positivo />
          <ResumoLinha label="Sangria de caixa (saiu)" value={-caixa.total_sangrias} negativo />
          <ResumoLinha
            label="Total esperado"
            value={esperadoCalc}
            destaque
          />
          <ResumoLinha
            label="Valor informado no fechamento"
            value={caixa.valor_informado ?? 0}
            destaque
            placeholder={caixa.valor_informado == null ? "Aguardando fechamento" : undefined}
          />
        </div>

        {/* Diferença final */}
        <div
          className={cn(
            "flex items-center justify-between rounded-lg border p-3",
            temDivergencia ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/30",
          )}
        >
          <span className="text-sm font-medium">Diferença final</span>
          <span
            className={cn(
              "text-lg font-bold tabular-nums",
              temDivergencia ? "text-destructive" : "text-foreground",
            )}
          >
            {caixa.diferenca != null ? formatBRL(caixa.diferenca) : "—"}
          </span>
        </div>

        {/* Formas de pagamento */}
        <div>
          <h3 className="mb-2 text-sm font-semibold">Formas de pagamento</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <FormaPgto icon={Banknote} label="Dinheiro" value={caixa.total_dinheiro} />
            <FormaPgto icon={Smartphone} label="PIX" value={caixa.total_pix} />
            <FormaPgto icon={CreditCard} label="Débito" value={caixa.total_debito} />
            <FormaPgto icon={CreditCard} label="Crédito" value={caixa.total_credito} />
            <FormaPgto icon={CreditCard} label="Boleto" value={caixa.total_boleto} />
            <FormaPgto icon={Wallet} label="iFood" value={caixa.total_ifood} />
            <FormaPgto icon={Wallet} label="Fiado" value={caixa.total_fiado} />
            <FormaPgto icon={Wallet} label="Outros" value={caixa.total_outros} />
          </div>
        </div>

        {/* Movimentações (sangrias / suprimentos) */}
        <div>
          <h3 className="mb-2 text-sm font-semibold">Movimentações manuais</h3>
          {loadingMovs ? (
            <div className="flex h-20 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : movs.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
              Nenhuma sangria ou suprimento de caixa registrado.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-9">Tipo</TableHead>
                    <TableHead className="h-9">Motivo</TableHead>
                    <TableHead className="h-9">Data</TableHead>
                    <TableHead className="h-9 text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movs.map((m) => {
                    const isEntrada = m.tipo === "suprimento";
                    return (
                      <TableRow key={m.id}>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              "capitalize",
                              isEntrada
                                ? "bg-success/15 text-success border-success/30"
                                : "bg-warning/15 text-warning border-warning/30",
                            )}
                          >
                            {m.tipo}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{m.motivo ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground tabular-nums">
                          {fmtDateTime(m.created_at)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums font-medium",
                            isEntrada ? "text-success" : "text-warning",
                          )}
                        >
                          {isEntrada ? "+" : "−"} {formatBRL(Math.abs(m.valor))}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* Observação de auditoria */}
        <div className="space-y-2">
          <Label className="text-sm">Observação de auditoria</Label>
          <Textarea
            placeholder="Registre justificativas para divergências, ações tomadas, etc."
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={3}
          />
          {caixa.observacao && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">Observação de abertura:</span> {caixa.observacao}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button onClick={salvarObservacao} disabled={salvando} className="gap-1.5">
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar observação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResumoLinha({
  label,
  value,
  positivo,
  negativo,
  destaque,
  placeholder,
}: {
  label: string;
  value: number;
  positivo?: boolean;
  negativo?: boolean;
  destaque?: boolean;
  placeholder?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-md border px-3 py-2 text-sm",
        destaque && "bg-muted/40 font-medium",
      )}
    >
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "tabular-nums",
          positivo && "text-success",
          negativo && "text-warning",
          destaque && "font-semibold text-foreground",
        )}
      >
        {placeholder ?? formatBRL(value)}
      </span>
    </div>
  );
}

function FormaPgto({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Banknote;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-semibold tabular-nums">{formatBRL(value)}</p>
      </div>
    </div>
  );
}
