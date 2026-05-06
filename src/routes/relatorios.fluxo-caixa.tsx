import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Loader2, ArrowUpRight, ArrowDownRight, Wallet } from "lucide-react";
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
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/relatorios/fluxo-caixa")({
  head: () => ({
    meta: [
      { title: "Fluxo de Caixa — Gestão Pro" },
      { name: "description", content: "Entradas e saídas no período." },
    ],
  }),
  component: () => (
    <ModuloGate chave="relatorios" titulo="Fluxo de Caixa">
      <Conteudo />
    </ModuloGate>
  ),
});

type Periodo = "7d" | "30d" | "mes" | "ano";

interface LancRow {
  id: string;
  descricao: string;
  tipo: string;
  valor: number;
  valor_pago: number;
  emissao: string;
  vencimento: string;
  pagamento: string | null;
  status: string;
  forma: string | null;
}

function calcRange(p: Periodo): { inicio: string; fim: string } {
  const today = new Date();
  const fim = today.toISOString().slice(0, 10);
  let inicio = new Date(today);
  if (p === "7d") inicio.setDate(today.getDate() - 6);
  else if (p === "30d") inicio.setDate(today.getDate() - 29);
  else if (p === "mes") inicio = new Date(today.getFullYear(), today.getMonth(), 1);
  else inicio = new Date(today.getFullYear(), 0, 1);
  return { inicio: inicio.toISOString().slice(0, 10), fim };
}

function Conteudo() {
  const navigate = useNavigate();
  const [periodo, setPeriodo] = useState<Periodo>("30d");
  const [rows, setRows] = useState<LancRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { inicio, fim } = calcRange(periodo);
      const { data, error } = await supabase
        .from("financeiro_lancamentos")
        .select(
          "id, descricao, tipo, valor, valor_pago, data_emissao, data_vencimento, data_pagamento, status, forma_pagamento",
        )
        .gte("data_vencimento", inicio)
        .lte("data_vencimento", fim)
        .order("data_vencimento", { ascending: false })
        .limit(1000);
      if (cancelled) return;
      if (error) {
        toast.error(error.message);
        setRows([]);
      } else {
        setRows(
          (data ?? []).map((l: any) => ({
            id: l.id,
            descricao: l.descricao,
            tipo: l.tipo,
            valor: Number(l.valor) || 0,
            valor_pago: Number(l.valor_pago) || 0,
            emissao: l.data_emissao,
            vencimento: l.data_vencimento,
            pagamento: l.data_pagamento,
            status: l.status,
            forma: l.forma_pagamento,
          })),
        );
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [periodo]);

  const totais = useMemo(() => {
    let entradas = 0;
    let saidas = 0;
    for (const r of rows) {
      if (r.tipo === "receita") entradas += r.valor_pago || r.valor;
      else if (r.tipo === "despesa") saidas += r.valor_pago || r.valor;
    }
    return { entradas, saidas, saldo: entradas - saidas };
  }, [rows]);

  async function handleExport() {
    if (rows.length === 0) {
      toast.warning("Sem dados para exportar.");
      return;
    }
    setExporting(true);
    toast.loading("Gerando relatório...", { id: "export-fluxo" });
    try {
      const columns: CsvColumn<LancRow>[] = [
        { header: "Descricao", accessor: (r) => r.descricao, type: "text" },
        { header: "Tipo", accessor: (r) => r.tipo, type: "text" },
        { header: "Valor", accessor: (r) => r.valor, type: "currency" },
        { header: "Valor pago", accessor: (r) => r.valor_pago, type: "currency" },
        { header: "Emissao", accessor: (r) => r.emissao, type: "date" },
        { header: "Vencimento", accessor: (r) => r.vencimento, type: "date" },
        { header: "Pagamento", accessor: (r) => r.pagamento ?? "", type: "date" },
        { header: "Status", accessor: (r) => r.status, type: "text" },
        { header: "Forma", accessor: (r) => r.forma ?? "", type: "text" },
      ];
      exportRowsToCSV("fluxo-caixa", rows, columns);
      toast.success("Download iniciado", { id: "export-fluxo" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha", { id: "export-fluxo" });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fluxo de Caixa"
        description="Entradas e saídas registradas no financeiro."
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
                <SelectItem value="7d">Últimos 7 dias</SelectItem>
                <SelectItem value="30d">Últimos 30 dias</SelectItem>
                <SelectItem value="mes">Este mês</SelectItem>
                <SelectItem value="ano">Este ano</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Entradas"
          value={formatBRL(totais.entradas)}
          icon={ArrowUpRight}
          iconTone="success"
        />
        <StatCard
          label="Saídas"
          value={formatBRL(totais.saidas)}
          icon={ArrowDownRight}
          iconTone="warning"
        />
        <StatCard
          label="Saldo do período"
          value={formatBRL(totais.saldo)}
          icon={Wallet}
          iconTone={totais.saldo >= 0 ? "primary" : "warning"}
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
              <Wallet className="h-8 w-8 opacity-40" />
              <p className="font-medium">Sem lançamentos no período</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Pagamento</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.descricao}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "capitalize",
                          r.tipo === "receita"
                            ? "bg-success/15 text-success border-success/30"
                            : "bg-warning/15 text-warning border-warning/30",
                        )}
                      >
                        {r.tipo}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(r.vencimento + "T00:00:00").toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.pagamento
                        ? new Date(r.pagamento + "T00:00:00").toLocaleDateString("pt-BR")
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatBRL(r.valor_pago || r.valor)}
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
