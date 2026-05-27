import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Loader2, Boxes, AlertTriangle, Package, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { CloudDependencyNotice } from "@/components/shared/CloudDependencyNotice";
import { StatCard } from "@/components/shared/StatCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  categoria_id: string | null;
  categoria_nome: string;
}

type StatusFiltro = "todos" | "baixo" | "zerado" | "normal" | "negativo";

function Conteudo() {
  const navigate = useNavigate();
  const [busca, setBusca] = useState("");
  const [categoriaFiltro, setCategoriaFiltro] = useState<string>("todas");
  const [statusFiltro, setStatusFiltro] = useState<StatusFiltro>("todos");
  const [ordenacao, setOrdenacao] = useState<"nome" | "saldo_desc" | "valor_desc" | "minimo">("nome");
  const [rows, setRows] = useState<ProdutoRow[]>([]);
  const [categorias, setCategorias] = useState<{ id: string; nome: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [prodRes, movRes, catRes] = await Promise.all([
        supabase
          .from("produtos")
          .select("id, sku, nome, unidade, preco_custo, preco_venda, estoque_minimo, categoria_id, categoria:categorias_produto(nome)")
          .eq("status", "ativo")
          .order("nome", { ascending: true })
          .limit(2000),
        supabase
          .from("estoque_movimentacoes")
          .select("produto_id, tipo, quantidade"),
        supabase
          .from("categorias_produto")
          .select("id, nome")
          .eq("ativo", true)
          .order("nome", { ascending: true }),
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
          categoria_id: p.categoria_id ?? null,
          categoria_nome: p.categoria?.nome ?? "Sem categoria",
        })),
      );
      setCategorias(catRes.data ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = busca.trim().toLowerCase();
    let out = rows;
    if (q) {
      out = out.filter(
        (r) => r.sku.toLowerCase().includes(q) || r.nome.toLowerCase().includes(q),
      );
    }
    if (categoriaFiltro !== "todas") {
      if (categoriaFiltro === "_sem") {
        out = out.filter((r) => !r.categoria_id);
      } else {
        out = out.filter((r) => r.categoria_id === categoriaFiltro);
      }
    }
    if (statusFiltro !== "todos") {
      out = out.filter((r) => {
        if (statusFiltro === "zerado") return r.saldo === 0;
        if (statusFiltro === "negativo") return r.saldo < 0;
        if (statusFiltro === "baixo") return r.minimo > 0 && r.saldo > 0 && r.saldo < r.minimo;
        if (statusFiltro === "normal") return r.minimo === 0 || r.saldo >= r.minimo;
        return true;
      });
    }
    const sorted = [...out];
    if (ordenacao === "nome") sorted.sort((a, b) => a.nome.localeCompare(b.nome));
    else if (ordenacao === "saldo_desc") sorted.sort((a, b) => b.saldo - a.saldo);
    else if (ordenacao === "valor_desc")
      sorted.sort((a, b) => b.saldo * b.custo - a.saldo * a.custo);
    else if (ordenacao === "minimo")
      sorted.sort((a, b) => (a.saldo - a.minimo) - (b.saldo - b.minimo));
    return sorted;
  }, [rows, busca, categoriaFiltro, statusFiltro, ordenacao]);

  const valorTotal = filtered.reduce((a, r) => a + r.saldo * r.custo, 0);
  const valorVenda = filtered.reduce((a, r) => a + r.saldo * r.venda, 0);
  const abaixoMin = filtered.filter((r) => r.minimo > 0 && r.saldo < r.minimo).length;
  const zerados = filtered.filter((r) => r.saldo === 0).length;

  function limparFiltros() {
    setBusca("");
    setCategoriaFiltro("todas");
    setStatusFiltro("todos");
    setOrdenacao("nome");
  }

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
        { header: "Categoria", accessor: (r) => r.categoria_nome, type: "text" },
        { header: "Unidade", accessor: (r) => r.unidade, type: "text" },
        { header: "Saldo", accessor: (r) => r.saldo, type: "number" },
        { header: "Minimo", accessor: (r) => r.minimo, type: "number" },
        { header: "Custo", accessor: (r) => r.custo, type: "currency" },
        { header: "Venda", accessor: (r) => r.venda, type: "currency" },
        { header: "Valor estoque (custo)", accessor: (r) => r.saldo * r.custo, type: "currency" },
        { header: "Valor estoque (venda)", accessor: (r) => r.saldo * r.venda, type: "currency" },
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
      <CloudDependencyNotice />
      <PageHeader
        title="Posição de Estoque"
        description="Saldo atual de produtos ativos, com filtro por categoria e status."
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
          label="Itens listados"
          value={filtered.length.toString()}
          icon={Package}
          iconTone="primary"
        />
        <StatCard
          label="Valor em estoque (custo)"
          value={formatBRL(valorTotal)}
          icon={Boxes}
          iconTone="success"
          hint={`A preço de venda: ${formatBRL(valorVenda)}`}
        />
        <StatCard
          label="Abaixo do mínimo"
          value={abaixoMin.toString()}
          icon={AlertTriangle}
          iconTone="warning"
        />
        <StatCard
          label="Zerados"
          value={zerados.toString()}
          icon={AlertTriangle}
          iconTone="danger"
        />
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Buscar</label>
              <Input
                placeholder="SKU ou nome..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Categoria</label>
              <Select value={categoriaFiltro} onValueChange={setCategoriaFiltro}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  <SelectItem value="_sem">Sem categoria</SelectItem>
                  {categorias.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <Select value={statusFiltro} onValueChange={(v) => setStatusFiltro(v as StatusFiltro)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="baixo">Abaixo do mínimo</SelectItem>
                  <SelectItem value="zerado">Zerado</SelectItem>
                  <SelectItem value="negativo">Saldo negativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Ordenar por</label>
              <Select value={ordenacao} onValueChange={(v) => setOrdenacao(v as typeof ordenacao)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nome">Nome (A-Z)</SelectItem>
                  <SelectItem value="saldo_desc">Maior saldo</SelectItem>
                  <SelectItem value="valor_desc">Maior valor em estoque</SelectItem>
                  <SelectItem value="minimo">Mais críticos (saldo - mínimo)</SelectItem>
                </SelectContent>
              </Select>
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
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="text-right">Mínimo</TableHead>
                  <TableHead className="text-right">Custo</TableHead>
                  <TableHead className="text-right">Valor estoque</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(0, 500).map((r) => {
                  const baixo = r.minimo > 0 && r.saldo < r.minimo;
                  const zero = r.saldo === 0;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {r.sku}
                      </TableCell>
                      <TableCell className="font-medium">{r.nome}</TableCell>
                      <TableCell className="text-muted-foreground">{r.categoria_nome}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {zero ? (
                          <Badge
                            variant="outline"
                            className="bg-destructive/15 text-destructive border-destructive/30"
                          >
                            0 {r.unidade}
                          </Badge>
                        ) : baixo ? (
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
          {filtered.length > 500 && (
            <div className="border-t p-3 text-center text-xs text-muted-foreground">
              Mostrando 500 de {filtered.length} itens. Refine os filtros ou exporte CSV.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
