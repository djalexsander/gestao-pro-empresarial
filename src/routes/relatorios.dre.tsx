import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Loader2, BarChart3, TrendingUp, TrendingDown } from "lucide-react";
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
import { ModuloGate } from "@/components/saas/ModuloGate";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/mock-data";
import { exportRowsToCSV, type CsvColumn } from "@/lib/export-csv";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/relatorios/dre")({
  head: () => ({
    meta: [
      { title: "DRE Simplificado — Gestão Pro" },
      { name: "description", content: "Demonstrativo de resultados do período." },
    ],
  }),
  component: () => (
    <ModuloGate chave="relatorios" titulo="DRE Simplificado">
      <Conteudo />
    </ModuloGate>
  ),
});

type Periodo = "mes" | "trimestre" | "ano";

interface DreLinha {
  conta: string;
  valor: number;
  destaque?: "positivo" | "negativo" | "total";
}

function calcRange(p: Periodo): { inicio: string; fim: string } {
  const today = new Date();
  const fim = today.toISOString().slice(0, 10);
  let inicio = new Date(today);
  if (p === "mes") inicio = new Date(today.getFullYear(), today.getMonth(), 1);
  else if (p === "trimestre") {
    const tri = Math.floor(today.getMonth() / 3) * 3;
    inicio = new Date(today.getFullYear(), tri, 1);
  } else inicio = new Date(today.getFullYear(), 0, 1);
  return { inicio: inicio.toISOString().slice(0, 10), fim };
}

function Conteudo() {
  const navigate = useNavigate();
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [receitaVendas, setReceitaVendas] = useState(0);
  const [outrasReceitas, setOutrasReceitas] = useState(0);
  const [despesas, setDespesas] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { inicio, fim } = calcRange(periodo);
      const [vendasRes, lancRes] = await Promise.all([
        supabase
          .from("vendas")
          .select("total, status")
          .gte("data_emissao", inicio)
          .lte("data_emissao", fim)
          .neq("status", "cancelada"),
        supabase
          .from("financeiro_lancamentos")
          .select("tipo, valor_pago, status")
          .gte("data_pagamento", inicio)
          .lte("data_pagamento", fim)
          .eq("status", "pago"),
      ]);
      if (cancelled) return;
      if (vendasRes.error) toast.error(vendasRes.error.message);
      if (lancRes.error) toast.error(lancRes.error.message);

      const rec = (vendasRes.data ?? []).reduce(
        (a: number, v: any) => a + (Number(v.total) || 0),
        0,
      );
      const outras = (lancRes.data ?? [])
        .filter((l: any) => l.tipo === "receita")
        .reduce((a: number, l: any) => a + (Number(l.valor_pago) || 0), 0);
      const desp = (lancRes.data ?? [])
        .filter((l: any) => l.tipo === "despesa")
        .reduce((a: number, l: any) => a + (Number(l.valor_pago) || 0), 0);

      setReceitaVendas(rec);
      setOutrasReceitas(outras);
      setDespesas(desp);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [periodo]);

  const linhas = useMemo<DreLinha[]>(() => {
    const receitaTotal = receitaVendas + outrasReceitas;
    const resultado = receitaTotal - despesas;
    return [
      { conta: "Receita de vendas", valor: receitaVendas, destaque: "positivo" },
      { conta: "Outras receitas", valor: outrasReceitas, destaque: "positivo" },
      { conta: "(=) Receita total", valor: receitaTotal, destaque: "total" },
      { conta: "(-) Despesas pagas", valor: -despesas, destaque: "negativo" },
      { conta: "(=) Resultado do período", valor: resultado, destaque: "total" },
    ];
  }, [receitaVendas, outrasReceitas, despesas]);

  async function handleExport() {
    setExporting(true);
    toast.loading("Gerando relatório...", { id: "export-dre" });
    try {
      const columns: CsvColumn<DreLinha>[] = [
        { header: "Conta", accessor: (r) => r.conta, type: "text" },
        { header: "Valor", accessor: (r) => r.valor, type: "currency" },
      ];
      exportRowsToCSV("dre", linhas, columns);
      toast.success("Download iniciado", { id: "export-dre" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha", { id: "export-dre" });
    } finally {
      setExporting(false);
    }
  }

  const resultado = receitaVendas + outrasReceitas - despesas;

  return (
    <div className="space-y-6">
      <PageHeader
        title="DRE Simplificado"
        description="Demonstrativo de resultados do período (regime de caixa)."
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
                <SelectItem value="mes">Este mês</SelectItem>
                <SelectItem value="trimestre">Este trimestre</SelectItem>
                <SelectItem value="ano">Este ano</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Receita total"
          value={formatBRL(receitaVendas + outrasReceitas)}
          icon={TrendingUp}
          iconTone="success"
        />
        <StatCard
          label="Despesas"
          value={formatBRL(despesas)}
          icon={TrendingDown}
          iconTone="warning"
        />
        <StatCard
          label="Resultado"
          value={formatBRL(resultado)}
          icon={BarChart3}
          iconTone={resultado >= 0 ? "primary" : "warning"}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Conta</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((l) => (
                  <TableRow
                    key={l.conta}
                    className={cn(l.destaque === "total" && "bg-muted/40 font-semibold")}
                  >
                    <TableCell>{l.conta}</TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        l.destaque === "negativo" && "text-warning",
                        l.destaque === "total" && l.valor >= 0 && "text-success",
                        l.destaque === "total" && l.valor < 0 && "text-destructive",
                      )}
                    >
                      {formatBRL(l.valor)}
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
