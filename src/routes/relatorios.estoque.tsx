import { supabase } from "@/integrations/supabase/client";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Loader2, Boxes, AlertTriangle, Package } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ModuloGate } from "@/components/saas/ModuloGate";
import { formatBRL } from "@/lib/mock-data";
import { exportRowsToCSV, type CsvColumn } from "@/lib/export-csv";

export const Route = createFileRoute("/relatorios/estoque")({
  head: () => ({
    meta: [
      { title: "Posição de Estoque — Gestão Pro" },
      { name: "description", content: "Saldo atual de produtos em estoque." },
    ],
  }),
  component: () => (
    <ModuloGate chave="relatorios" titulo="Posição de Estoque">
      <Conteudo />
    </ModuloGate>
  ),
});

interface ProdutoRow {
  id: string;
  sku: string;
  nome: string;
  unidade: string;
  custo: number;
  venda: number;
  minimo: number;
  saldo: number;
}

function Conteudo() {
  const navigate = useNavigate();
  const [busca, setBusca] = useState("");
  const [rows, setRows] = useState<ProdutoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [prodRes, movRes] = await Promise.all([
        supabase
          .from("produtos")
          .select("id, sku, nome, unidade, preco_custo, preco_venda, estoque_minimo")
          .eq("status", "ativo")
          .order("nome", { ascending: true })
          .limit(2000),
        supabase
          .from("estoque_movimentacoes")
          .select("produto_id, tipo, quantidade"),
      ]);
      if (cancelled) return;
      if (prodRes.error) {
        toast.error(prodRes.error.message);
        setLoading(false);
        return;
      }
      const saldos = new Map<string, number>();
      for (const m of movRes.data ?? []) {
        const sinal =
          m.tipo === "entrada" || m.tipo === "devolucao"
            ? 1
            : m.tipo === "saida" || m.tipo === "transferencia"
              ? -1
              : 1;
        saldos.set(m.produto_id, (saldos.get(m.produto_id) ?? 0) + sinal * Number(m.quantidade));
      }
      setRows(
        (prodRes.data ?? []).map((p: any) => ({
          id: p.id,
          sku: p.sku,
          nome: p.nome,
          unidade: p.unidade,
          custo: Number(p.preco_custo) || 0,
          venda: Number(p.preco_venda) || 0,
          minimo: Number(p.estoque_minimo) || 0,
          saldo: saldos.get(p.id) ?? 0,
        })),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.sku.toLowerCase().includes(q) || r.nome.toLowerCase().includes(q),
    );
  }, [rows, busca]);

  const valorTotal = filtered.reduce((a, r) => a + r.saldo * r.custo, 0);
  const abaixoMin = filtered.filter((r) => r.minimo > 0 && r.saldo < r.minimo).length;

  async function handleExport() {
    if (filtered.length === 0) {
      toast.warning("Sem dados para exportar.");
      return;
    }
    setExporting(true);
    toast.loading("Gerando relatório...", { id: "export-estoque" });
    try {
      const columns: CsvColumn<ProdutoRow>[] = [
        { header: "SKU", accessor: (r) => r.sku, type: "text" },
        { header: "Produto", accessor: (r) => r.nome, type: "text" },
        { header: "Unidade", accessor: (r) => r.unidade, type: "text" },
        { header: "Saldo", accessor: (r) => r.saldo, type: "number" },
        { header: "Minimo", accessor: (r) => r.minimo, type: "number" },
        { header: "Custo", accessor: (r) => r.custo, type: "currency" },
        { header: "Venda", accessor: (r) => r.venda, type: "currency" },
        { header: "Valor estoque", accessor: (r) => r.saldo * r.custo, type: "currency" },
      ];
      exportRowsToCSV("estoque", filtered, columns);
      toast.success("Download iniciado", { id: "export-estoque" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha", { id: "export-estoque" });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Posição de Estoque"
        description="Saldo atual de produtos ativos."
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

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Itens cadastrados"
          value={filtered.length.toString()}
          icon={Package}
          iconTone="primary"
        />
        <StatCard
          label="Valor em estoque (custo)"
          value={formatBRL(valorTotal)}
          icon={Boxes}
          iconTone="success"
        />
        <StatCard
          label="Abaixo do mínimo"
          value={abaixoMin.toString()}
          icon={AlertTriangle}
          iconTone="warning"
        />
      </div>

      <Card>
        <CardContent className="p-4">
          <Input
            placeholder="Buscar por SKU ou nome..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-1 text-muted-foreground">
              <Boxes className="h-8 w-8 opacity-40" />
              <p className="font-medium">Nenhum produto encontrado</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="text-right">Mínimo</TableHead>
                  <TableHead className="text-right">Custo</TableHead>
                  <TableHead className="text-right">Valor estoque</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(0, 500).map((r) => {
                  const baixo = r.minimo > 0 && r.saldo < r.minimo;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {r.sku}
                      </TableCell>
                      <TableCell className="font-medium">{r.nome}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {baixo ? (
                          <Badge
                            variant="outline"
                            className="bg-warning/15 text-warning border-warning/30"
                          >
                            {r.saldo} {r.unidade}
                          </Badge>
                        ) : (
                          <span>
                            {r.saldo} {r.unidade}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {r.minimo}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatBRL(r.custo)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatBRL(r.saldo * r.custo)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
