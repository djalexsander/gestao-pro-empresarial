import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Download,
  Loader2,
  ShoppingCart,
  Receipt,
  TrendingUp,
  Users,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { PageHeader } from "@/components/shared/PageHeader";
import { CloudDependencyNotice } from "@/components/shared/CloudDependencyNotice";
import { StatCard } from "@/components/shared/StatCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import { ModuloGate } from "@/components/saas/ModuloGate";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/mock-data";
import { exportRowsToCSV, type CsvColumn } from "@/lib/export-csv";

export const Route = createFileRoute("/relatorios/compras")({
  head: () => ({
    meta: [
      { title: "Relatório de Compras — Gestão Pro" },
      { name: "description", content: "Compras por fornecedor e período." },
    ],
  }),
  component: () => (
    <ModuloGate chave="relatorios" titulo="Relatório de Compras">
      <Conteudo />
    </ModuloGate>
  ),
});

type Periodo = "7d" | "30d" | "mes" | "ano" | "todos" | "personalizado";

interface CompraRow {
  id: string;
  numero: string;
  data: string;
  fornecedor_id: string | null;
  fornecedor: string;
  total: number;
  status: string;
}

function calcRange(p: Periodo): { inicio: string; fim: string } {
  const today = new Date();
  const fim = today.toISOString().slice(0, 10);
  let inicio = new Date(today);
  if (p === "7d") inicio.setDate(today.getDate() - 6);
  else if (p === "30d") inicio.setDate(today.getDate() - 29);
  else if (p === "mes") inicio = new Date(today.getFullYear(), today.getMonth(), 1);
  else if (p === "ano") inicio = new Date(today.getFullYear(), 0, 1);
  else inicio = new Date(2000, 0, 1);
  return { inicio: inicio.toISOString().slice(0, 10), fim };
}

function Conteudo() {
  const navigate = useNavigate();
  const [periodo, setPeriodo] = useState<Periodo>("30d");
  const [inicioCustom, setInicioCustom] = useState("");
  const [fimCustom, setFimCustom] = useState("");
  const [fornecedorFiltro, setFornecedorFiltro] = useState("todos");
  const [statusFiltro, setStatusFiltro] = useState("todos");
  const [busca, setBusca] = useState("");
  const [rows, setRows] = useState<CompraRow[]>([]);
  const [fornecedores, setFornecedores] = useState<{ id: string; nome: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const range = useMemo(() => {
    if (periodo === "personalizado" && inicioCustom && fimCustom) {
      return { inicio: inicioCustom, fim: fimCustom };
    }
    return calcRange(periodo);
  }, [periodo, inicioCustom, fimCustom]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { inicio, fim } = range;
      const [compRes, fornRes] = await Promise.all([
        supabase
          .from("compras")
          .select(
            "id, numero, data_emissao, total, status, fornecedor_id, fornecedor:fornecedores(razao_social)",
          )
          .gte("data_emissao", inicio)
          .lte("data_emissao", fim)
          .order("data_emissao", { ascending: false })
          .limit(1000),
        supabase
          .from("fornecedores")
          .select("id, razao_social")
          .order("razao_social", { ascending: true })
          .limit(500),
      ]);
      if (cancelled) return;
      if (compRes.error) {
        toast.error(compRes.error.message);
        setRows([]);
      } else {
        setRows(
          (compRes.data ?? []).map((c: any) => ({
            id: c.id,
            numero: c.numero,
            data: c.data_emissao,
            fornecedor_id: c.fornecedor_id ?? null,
            fornecedor: c.fornecedor?.razao_social ?? "—",
            total: Number(c.total) || 0,
            status: c.status,
          })),
        );
      }
      setFornecedores(
        (fornRes.data ?? []).map((f: any) => ({ id: f.id, nome: f.razao_social })),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [range.inicio, range.fim]);

  const filtered = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !(r.numero.toLowerCase().includes(q) || r.fornecedor.toLowerCase().includes(q)))
        return false;
      if (fornecedorFiltro !== "todos" && r.fornecedor_id !== fornecedorFiltro) return false;
      if (statusFiltro !== "todos" && r.status !== statusFiltro) return false;
      return true;
    });
  }, [rows, busca, fornecedorFiltro, statusFiltro]);

  const total = filtered.reduce((a, r) => a + r.total, 0);
  const ticketMedio = filtered.length > 0 ? total / filtered.length : 0;
  const fornecedoresAtivos = useMemo(
    () => new Set(filtered.map((r) => r.fornecedor_id ?? r.fornecedor)).size,
    [filtered],
  );

  // Top fornecedores
  const topFornecedores = useMemo(() => {
    const map = new Map<string, { nome: string; total: number; qtd: number }>();
    for (const r of filtered) {
      const key = r.fornecedor_id ?? r.fornecedor;
      const e = map.get(key) ?? { nome: r.fornecedor, total: 0, qtd: 0 };
      e.total += r.total;
      e.qtd += 1;
      map.set(key, e);
    }
    return Array.from(map.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [filtered]);

  const statusOptions = useMemo(() => {
    return Array.from(new Set(rows.map((r) => r.status))).filter(Boolean);
  }, [rows]);

  function limparFiltros() {
    setPeriodo("30d");
    setInicioCustom("");
    setFimCustom("");
    setFornecedorFiltro("todos");
    setStatusFiltro("todos");
    setBusca("");
  }

  async function handleExport() {
    if (filtered.length === 0) {
      toast.warning("Sem dados para exportar.");
      return;
    }
    setExporting(true);
    toast.loading("Gerando relatório...", { id: "export-compras" });
    try {
      const columns: CsvColumn<CompraRow>[] = [
        { header: "Numero", accessor: (r) => r.numero, type: "text" },
        { header: "Data", accessor: (r) => r.data, type: "date" },
        { header: "Fornecedor", accessor: (r) => r.fornecedor, type: "text" },
        { header: "Total", accessor: (r) => r.total, type: "currency" },
        { header: "Status", accessor: (r) => r.status, type: "text" },
      ];
      exportRowsToCSV("compras", filtered, columns);
      toast.success("Download iniciado", { id: "export-compras" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha", { id: "export-compras" });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <CloudDependencyNotice />
      <PageHeader
        title="Relatório de Compras"
        description="Compras por fornecedor, período e status."
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
            <Button size="sm" className="gap-1.5" disabled={exporting} onClick={handleExport}>
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total comprado"
          value={formatBRL(total)}
          icon={Receipt}
          iconTone="primary"
        />
        <StatCard
          label="Quantidade"
          value={filtered.length.toString()}
          icon={ShoppingCart}
          iconTone="info"
        />
        <StatCard
          label="Ticket médio"
          value={formatBRL(ticketMedio)}
          icon={TrendingUp}
          iconTone="success"
        />
        <StatCard
          label="Fornecedores"
          value={fornecedoresAtivos.toString()}
          icon={Users}
          iconTone="warning"
        />
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Período</label>
              <Select value={periodo} onValueChange={(v) => setPeriodo(v as Periodo)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">Últimos 7 dias</SelectItem>
                  <SelectItem value="30d">Últimos 30 dias</SelectItem>
                  <SelectItem value="mes">Este mês</SelectItem>
                  <SelectItem value="ano">Este ano</SelectItem>
                  <SelectItem value="todos">Todo período</SelectItem>
                  <SelectItem value="personalizado">Personalizado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {periodo === "personalizado" && (
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
              <label className="text-xs font-medium text-muted-foreground">Fornecedor</label>
              <Select value={fornecedorFiltro} onValueChange={setFornecedorFiltro}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {fornecedores.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <Select value={statusFiltro} onValueChange={setStatusFiltro}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {statusOptions.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Buscar</label>
              <Input
                placeholder="Nº ou fornecedor..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={limparFiltros} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" />
              Limpar filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      {topFornecedores.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-3 text-sm font-semibold">Top 5 fornecedores no período</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead className="text-right">Nº compras</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topFornecedores.map((f) => (
                  <TableRow key={f.nome}>
                    <TableCell className="font-medium">{f.nome}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.qtd}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatBRL(f.total)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-1 text-muted-foreground">
              <ShoppingCart className="h-8 w-8 opacity-40" />
              <p className="font-medium">Nenhuma compra encontrada</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Número</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {r.numero}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(new Date(r.data + "T00:00:00"), "dd/MM/yyyy")}
                    </TableCell>
                    <TableCell className="font-medium">{r.fornecedor}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatBRL(r.total)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {r.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
