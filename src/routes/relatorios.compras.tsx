import { fetchComprasPeriodoAudit } from "@/integrations/data/relatorios-audit";
import { useEmpresaAtual } from "@/hooks/useEmpresa";
import { AuditoriaCard } from "@/components/relatorios/AuditoriaCard";
import type { RelatorioAuditoria } from "@/lib/relatorios/audit";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Loader2, ShoppingCart, Receipt, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
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

type Periodo = "7d" | "30d" | "mes" | "ano" | "todos";

interface CompraRow {
  id: string;
  numero: string;
  data: string;
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
  const [busca, setBusca] = useState("");
  const [rows, setRows] = useState<CompraRow[]>([]);
  const [audit, setAudit] = useState<RelatorioAuditoria | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const { empresaAtual } = useEmpresaAtual();
  const ownerId = empresaAtual?.owner_id ?? null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { inicio, fim } = calcRange(periodo);
      try {
        const result = await fetchComprasPeriodoAudit(ownerId, { inicio, fim });
        if (cancelled) return;
        setRows(
          result.rows.map((r) => ({
            id: r.id,
            numero: r.numero,
            data: r.data,
            fornecedor: r.fornecedor,
            total: r.total,
            status: r.status,
          })),
        );
        setAudit(result.audit);
      } catch (e) {
        if (cancelled) return;
        toast.error(e instanceof Error ? e.message : "Falha ao carregar");
        setRows([]);
        setAudit(null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [periodo, ownerId]);

  const filtered = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.numero.toLowerCase().includes(q) || r.fornecedor.toLowerCase().includes(q),
    );
  }, [rows, busca]);

  const total = filtered.reduce((a, r) => a + r.total, 0);
  const ticketMedio = filtered.length > 0 ? total / filtered.length : 0;

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
      <PageHeader
        title="Relatório de Compras"
        description="Compras por fornecedor e período."
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

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Período
            </label>
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
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Buscar
            </label>
            <Input
              placeholder="Nº ou fornecedor..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
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
      </div>

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
                      {new Date(r.data + "T00:00:00").toLocaleDateString("pt-BR")}
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

      {audit && <AuditoriaCard audit={audit} />}
    </div>
  );
}
