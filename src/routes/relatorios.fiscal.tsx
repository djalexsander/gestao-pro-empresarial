import { fetchNotasFiscaisAudit } from "@/integrations/data/relatorios-audit";
import { useEmpresaAtual } from "@/hooks/useEmpresa";
import { AuditoriaCard } from "@/components/relatorios/AuditoriaCard";
import type { RelatorioAuditoria } from "@/lib/relatorios/audit";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Loader2, FileText } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
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

export const Route = createFileRoute("/relatorios/fiscal")({
  head: () => ({
    meta: [
      { title: "Relatório Fiscal — Gestão Pro" },
      { name: "description", content: "Notas fiscais emitidas." },
    ],
  }),
  component: () => (
    <ModuloGate chave="relatorios" titulo="Relatório Fiscal">
      <Conteudo />
    </ModuloGate>
  ),
});

type Periodo = "30d" | "mes" | "ano" | "todos";

interface NotaRow {
  id: string;
  numero: string;
  nf: string;
  serie: string;
  data: string;
  total: number;
  status: string;
}

function calcRange(p: Periodo): { inicio: string; fim: string } {
  const today = new Date();
  const fim = today.toISOString().slice(0, 10);
  let inicio = new Date(today);
  if (p === "30d") inicio.setDate(today.getDate() - 29);
  else if (p === "mes") inicio = new Date(today.getFullYear(), today.getMonth(), 1);
  else if (p === "ano") inicio = new Date(today.getFullYear(), 0, 1);
  else inicio = new Date(2000, 0, 1);
  return { inicio: inicio.toISOString().slice(0, 10), fim };
}

function Conteudo() {
  const navigate = useNavigate();
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [rows, setRows] = useState<NotaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { inicio, fim } = calcRange(periodo);
      try {
        const data = await dataClient.relatorios.notasFiscais({ inicio, fim });
        if (cancelled) return;
        setRows(data);
      } catch (e) {
        if (cancelled) return;
        toast.error(e instanceof Error ? e.message : "Falha ao carregar");
        setRows([]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [periodo]);

  const total = useMemo(() => rows.reduce((a, r) => a + r.total, 0), [rows]);

  async function handleExport() {
    if (rows.length === 0) {
      toast.warning("Sem dados para exportar.");
      return;
    }
    setExporting(true);
    toast.loading("Gerando relatório...", { id: "export-fiscal" });
    try {
      const columns: CsvColumn<NotaRow>[] = [
        { header: "Venda", accessor: (r) => r.numero, type: "text" },
        { header: "NF", accessor: (r) => r.nf, type: "text" },
        { header: "Serie", accessor: (r) => r.serie, type: "text" },
        { header: "Data", accessor: (r) => r.data, type: "datetime" },
        { header: "Total", accessor: (r) => r.total, type: "currency" },
        { header: "Status", accessor: (r) => r.status, type: "text" },
      ];
      exportRowsToCSV("fiscal", rows, columns);
      toast.success("Download iniciado", { id: "export-fiscal" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha", { id: "export-fiscal" });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relatório Fiscal"
        description="Notas fiscais emitidas por período."
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
        <CardContent className="p-4">
          <div className="max-w-xs">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Período
            </label>
            <Select value={periodo} onValueChange={(v) => setPeriodo(v as Periodo)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30d">Últimos 30 dias</SelectItem>
                <SelectItem value="mes">Este mês</SelectItem>
                <SelectItem value="ano">Este ano</SelectItem>
                <SelectItem value="todos">Todo período</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard
          label="Notas emitidas"
          value={rows.length.toString()}
          icon={FileText}
          iconTone="primary"
        />
        <StatCard
          label="Total faturado"
          value={formatBRL(total)}
          icon={FileText}
          iconTone="success"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-1 text-muted-foreground">
              <FileText className="h-8 w-8 opacity-40" />
              <p className="font-medium">Nenhuma NF encontrada no período</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>NF</TableHead>
                  <TableHead>Série</TableHead>
                  <TableHead>Venda</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono">{r.nf}</TableCell>
                    <TableCell className="text-muted-foreground">{r.serie || "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {r.numero}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(r.data + "T00:00:00").toLocaleDateString("pt-BR")}
                    </TableCell>
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
