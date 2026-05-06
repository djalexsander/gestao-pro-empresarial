import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  Filter,
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  Receipt,
  ChevronDown,
  ChevronRight,
  ShoppingBag,
  TrendingUp,
  DollarSign,
  Package,
  Eye,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useClientesFull } from "@/hooks/useClientes";
import { useFuncionariosAtivos } from "@/hooks/useFuncionarios";
import { useCaixasHistorico } from "@/hooks/useCaixa";
import { useProdutos, useCategorias } from "@/hooks/useProdutos";
import { DetalheVendaDialog } from "@/components/vendas/DetalheVendaDialog";
import { ModuloGate } from "@/components/saas/ModuloGate";
import { formatBRL } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { exportarBlocoCSV, exportarBlocoPDF } from "@/lib/export-bloco";
import { toast } from "sonner";

export const Route = createFileRoute("/produtos-vendidos")({
  head: () => ({
    meta: [
      { title: "Produtos vendidos — Gestão Pro" },
      {
        name: "description",
        content:
          "Consulta de vendas e produtos vendidos por dia ou período, com filtros, agrupamento e exportação.",
      },
    ],
  }),
  component: ProdutosVendidosPage,
});

const FORMA_LABEL: Record<string, string> = {
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

const STATUS_PG_LABEL: Record<string, string> = {
  pago: "Pago",
  pendente: "Pendente",
  parcial: "Parcial",
  cancelado: "Cancelado",
  vencido: "Vencido",
};

interface ItemRow {
  itemId: string;
  vendaId: string;
  vendaNumero: string;
  dataEmissao: string; // yyyy-mm-dd
  vendaStatus: string;
  vendaStatusPagamento: string;
  formaPagamento: string | null;
  clienteId: string | null;
  clienteNome: string | null;
  operadorId: string | null;
  caixaId: string | null;
  produtoId: string;
  produtoNome: string;
  produtoSku: string;
  categoriaId: string | null;
  precoCusto: number;
  quantidade: number;
  precoUnitario: number;
  total: number;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoISO(d: number): string {
  const dt = new Date();
  dt.setDate(dt.getDate() - d);
  return dt.toISOString().slice(0, 10);
}

function formatDateLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function ProdutosVendidosPage() {
  return (
    <ModuloGate chave="vendas" titulo="Produtos vendidos">
      <ProdutosVendidosContent />
    </ModuloGate>
  );
}

function ProdutosVendidosContent() {
  const [inicio, setInicio] = useState(daysAgoISO(7));
  const [fim, setFim] = useState(todayISO());
  const [busca, setBusca] = useState("");
  const [produtoId, setProdutoId] = useState<string>("todos");
  const [clienteId, setClienteId] = useState<string>("todos");
  const [operadorId, setOperadorId] = useState<string>("todos");
  const [caixaId, setCaixaId] = useState<string>("todos");
  const [forma, setForma] = useState<string>("todos");
  const [statusPag, setStatusPag] = useState<string>("todos");
  const [categoriaId, setCategoriaId] = useState<string>("todos");
  const [filtrosOpen, setFiltrosOpen] = useState(false);

  const [vendaSelecionada, setVendaSelecionada] = useState<string | null>(null);
  const [produtoDetalhe, setProdutoDetalhe] = useState<{
    id: string;
    nome: string;
    rows: ItemRow[];
  } | null>(null);

  const { data: clientes = [] } = useClientesFull();
  const { data: funcionarios = [] } = useFuncionariosAtivos();
  const { data: caixas = [] } = useCaixasHistorico(200);
  const { data: produtos = [] } = useProdutos();
  const { data: categorias = [] } = useCategorias();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["produtos-vendidos", inicio, fim],
    queryFn: async (): Promise<ItemRow[]> => {
      const { data, error } = await supabase
        .from("vendas")
        .select(
          `id, numero, data_emissao, status, status_pagamento, forma_pagamento,
           cliente_id, operador_id, caixa_id,
           cliente:clientes(nome),
           itens:venda_itens(
             id, produto_id, descricao, quantidade, preco_unitario, total,
             produto:produtos(nome, sku, categoria_id, preco_custo)
           )`,
        )
        .gte("data_emissao", inicio)
        .lte("data_emissao", fim)
        .neq("status", "cancelada")
        .order("data_emissao", { ascending: false })
        .limit(2000);
      if (error) throw error;

      const out: ItemRow[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const v of (data ?? []) as any[]) {
        const itens = (v.itens ?? []) as any[]; // eslint-disable-line
        for (const it of itens) {
          out.push({
            itemId: it.id,
            vendaId: v.id,
            vendaNumero: v.numero,
            dataEmissao: v.data_emissao,
            vendaStatus: v.status,
            vendaStatusPagamento: v.status_pagamento,
            formaPagamento: v.forma_pagamento,
            clienteId: v.cliente_id,
            clienteNome: v.cliente?.nome ?? null,
            operadorId: v.operador_id,
            caixaId: v.caixa_id,
            produtoId: it.produto_id,
            produtoNome: it.produto?.nome ?? it.descricao ?? "—",
            produtoSku: it.produto?.sku ?? "",
            categoriaId: it.produto?.categoria_id ?? null,
            precoCusto: Number(it.produto?.preco_custo) || 0,
            quantidade: Number(it.quantidade) || 0,
            precoUnitario: Number(it.preco_unitario) || 0,
            total: Number(it.total) || 0,
          });
        }
      }
      return out;
    },
  });

  const filtered = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.produtoNome.toLowerCase().includes(q) && !r.vendaNumero.toLowerCase().includes(q))
        return false;
      if (produtoId !== "todos" && r.produtoId !== produtoId) return false;
      if (clienteId !== "todos" && r.clienteId !== clienteId) return false;
      if (operadorId !== "todos" && r.operadorId !== operadorId) return false;
      if (caixaId !== "todos" && r.caixaId !== caixaId) return false;
      if (forma !== "todos" && r.formaPagamento !== forma) return false;
      if (statusPag !== "todos" && r.vendaStatusPagamento !== statusPag) return false;
      if (categoriaId !== "todos" && r.categoriaId !== categoriaId) return false;
      return true;
    });
  }, [rows, busca, produtoId, clienteId, operadorId, caixaId, forma, statusPag, categoriaId]);

  // Agrupamento por dia → produto
  const grupos = useMemo(() => {
    const porDia = new Map<string, ItemRow[]>();
    for (const r of filtered) {
      if (!porDia.has(r.dataEmissao)) porDia.set(r.dataEmissao, []);
      porDia.get(r.dataEmissao)!.push(r);
    }
    return Array.from(porDia.entries())
      .map(([dia, items]) => {
        const produtosMap = new Map<
          string,
          {
            produtoId: string;
            produtoNome: string;
            produtoSku: string;
            quantidade: number;
            total: number;
            custo: number;
            vendas: Set<string>;
            vendasNumeros: Set<string>;
            rows: ItemRow[];
          }
        >();
        for (const it of items) {
          const e = produtosMap.get(it.produtoId) ?? {
            produtoId: it.produtoId,
            produtoNome: it.produtoNome,
            produtoSku: it.produtoSku,
            quantidade: 0,
            total: 0,
            custo: 0,
            vendas: new Set<string>(),
            vendasNumeros: new Set<string>(),
            rows: [],
          };
          e.quantidade += it.quantidade;
          e.total += it.total;
          e.custo += it.quantidade * it.precoCusto;
          e.vendas.add(it.vendaId);
          e.vendasNumeros.add(it.vendaNumero);
          e.rows.push(it);
          produtosMap.set(it.produtoId, e);
        }
        const produtosArr = Array.from(produtosMap.values()).sort(
          (a, b) => b.total - a.total,
        );
        const totalDia = items.reduce((s, i) => s + i.total, 0);
        const custoDia = items.reduce((s, i) => s + i.quantidade * i.precoCusto, 0);
        const qtdDia = items.reduce((s, i) => s + i.quantidade, 0);
        const vendasDia = new Set(items.map((i) => i.vendaId)).size;
        return {
          dia,
          produtos: produtosArr,
          totalDia,
          custoDia,
          lucroDia: totalDia - custoDia,
          qtdDia,
          vendasDia,
        };
      })
      .sort((a, b) => (a.dia < b.dia ? 1 : -1));
  }, [filtered]);

  const totais = useMemo(() => {
    const totalVendido = filtered.reduce((s, i) => s + i.total, 0);
    const custo = filtered.reduce((s, i) => s + i.quantidade * i.precoCusto, 0);
    const qtd = filtered.reduce((s, i) => s + i.quantidade, 0);
    const vendas = new Set(filtered.map((i) => i.vendaId)).size;
    return { totalVendido, custo, lucro: totalVendido - custo, qtd, vendas };
  }, [filtered]);

  const [diasFechados, setDiasFechados] = useState<Record<string, boolean>>({});
  function toggleDia(d: string) {
    setDiasFechados((p) => ({ ...p, [d]: !p[d] }));
  }

  function periodoLabel() {
    return `${inicio.split("-").reverse().join("/")} a ${fim.split("-").reverse().join("/")}`;
  }

  type Linha = {
    Data: string;
    Produto: string;
    SKU: string;
    Quantidade: number;
    "Total vendido": number;
    "Custo total": number;
    "Lucro bruto": number;
    Vendas: string;
  };

  const linhasExport: Linha[] = useMemo(() => {
    const out: Linha[] = [];
    for (const g of grupos) {
      for (const p of g.produtos) {
        out.push({
          Data: g.dia.split("-").reverse().join("/"),
          Produto: p.produtoNome,
          SKU: p.produtoSku,
          Quantidade: p.quantidade,
          "Total vendido": p.total,
          "Custo total": p.custo,
          "Lucro bruto": p.total - p.custo,
          Vendas: Array.from(p.vendasNumeros).join(", "),
        });
      }
    }
    return out;
  }, [grupos]);

  async function handleExportCSV() {
    if (linhasExport.length === 0) {
      toast.info("Nada para exportar.");
      return;
    }
    await exportarBlocoCSV(
      "produtos-vendidos",
      linhasExport,
      [
        { header: "Data", accessor: (r: Linha) => r.Data },
        { header: "Produto", accessor: (r: Linha) => r.Produto },
        { header: "SKU", accessor: (r: Linha) => r.SKU },
        { header: "Quantidade", accessor: (r: Linha) => r.Quantidade, type: "number" },
        { header: "Total vendido", accessor: (r: Linha) => r["Total vendido"], type: "currency" },
        { header: "Custo total", accessor: (r: Linha) => r["Custo total"], type: "currency" },
        { header: "Lucro bruto", accessor: (r: Linha) => r["Lucro bruto"], type: "currency" },
        { header: "Vendas", accessor: (r: Linha) => r.Vendas },
      ],
      { relatorio: "Produtos vendidos", periodo: periodoLabel() },
    );
  }

  async function handleExportPDF() {
    if (linhasExport.length === 0) {
      toast.info("Nada para exportar.");
      return;
    }
    await exportarBlocoPDF({
      titulo: "Produtos vendidos",
      subtitulo: "Agrupado por dia",
      periodo: periodoLabel(),
      resumo: [
        { label: "Total vendido", valor: formatBRL(totais.totalVendido) },
        { label: "Custo total", valor: formatBRL(totais.custo) },
        { label: "Lucro bruto", valor: formatBRL(totais.lucro) },
        { label: "Itens", valor: String(totais.qtd) },
        { label: "Vendas", valor: String(totais.vendas) },
      ],
      tabela: {
        header: ["Data", "Produto", "Qtd", "Total", "Custo", "Lucro", "Vendas"],
        rows: linhasExport,
        formatRow: (r) => [
          r.Data,
          r.Produto,
          r.Quantidade,
          formatBRL(r["Total vendido"]),
          formatBRL(r["Custo total"]),
          formatBRL(r["Lucro bruto"]),
          r.Vendas,
        ],
      },
    });
  }

  function limparFiltros() {
    setBusca("");
    setProdutoId("todos");
    setClienteId("todos");
    setOperadorId("todos");
    setCaixaId("todos");
    setForma("todos");
    setStatusPag("todos");
    setCategoriaId("todos");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Produtos vendidos"
        description="Consulta de vendas por dia ou período, com agrupamento por produto."
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Download className="h-4 w-4" /> Exportar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExportCSV}>
                <FileText className="mr-2 h-4 w-4" /> CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportPDF}>
                <FileText className="mr-2 h-4 w-4" /> PDF
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  toast.info("Use Imprimir do navegador para gerar PNG/print.")
                }
              >
                <ImageIcon className="mr-2 h-4 w-4" /> PNG (print)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="Total vendido"
          value={formatBRL(totais.totalVendido)}
          icon={DollarSign}
          iconTone="success"
        />
        <StatCard
          label="Custo total"
          value={formatBRL(totais.custo)}
          icon={Package}
          iconTone="warning"
        />
        <StatCard
          label="Lucro bruto"
          value={formatBRL(totais.lucro)}
          icon={TrendingUp}
          iconTone={totais.lucro >= 0 ? "success" : "danger"}
        />
        <StatCard label="Itens vendidos" value={String(totais.qtd)} icon={ShoppingBag} />
        <StatCard label="Vendas" value={String(totais.vendas)} icon={Receipt} />
      </div>

      {/* Filtros principais */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Início</label>
              <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Fim</label>
              <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
            </div>
            <div className="lg:col-span-2">
              <label className="mb-1 block text-xs text-muted-foreground">Buscar</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Produto ou número da venda..."
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFiltrosOpen((o) => !o)}
            >
              <Filter className="h-4 w-4" />
              {filtrosOpen ? "Esconder filtros" : "Mais filtros"}
            </Button>
            {(produtoId !== "todos" ||
              clienteId !== "todos" ||
              operadorId !== "todos" ||
              caixaId !== "todos" ||
              forma !== "todos" ||
              statusPag !== "todos" ||
              categoriaId !== "todos" ||
              busca) && (
              <Button variant="ghost" size="sm" onClick={limparFiltros}>
                Limpar
              </Button>
            )}
            <div className="ml-auto flex flex-wrap gap-1">
              <PresetBtn label="Hoje" onClick={() => { setInicio(todayISO()); setFim(todayISO()); }} />
              <PresetBtn label="7 dias" onClick={() => { setInicio(daysAgoISO(6)); setFim(todayISO()); }} />
              <PresetBtn label="30 dias" onClick={() => { setInicio(daysAgoISO(29)); setFim(todayISO()); }} />
            </div>
          </div>

          {filtrosOpen && (
            <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-4">
              <SelectField label="Produto" value={produtoId} onChange={setProdutoId}
                options={[{ value: "todos", label: "Todos" }, ...produtos.map((p) => ({ value: p.id, label: p.nome }))]} />
              <SelectField label="Categoria" value={categoriaId} onChange={setCategoriaId}
                options={[{ value: "todos", label: "Todas" }, ...categorias.map((c) => ({ value: c.id, label: c.nome }))]} />
              <SelectField label="Cliente" value={clienteId} onChange={setClienteId}
                options={[{ value: "todos", label: "Todos" }, ...clientes.map((c) => ({ value: c.id, label: c.nome }))]} />
              <SelectField label="Operador" value={operadorId} onChange={setOperadorId}
                options={[{ value: "todos", label: "Todos" }, ...funcionarios.map((f) => ({ value: f.id, label: f.nome }))]} />
              <SelectField label="Caixa" value={caixaId} onChange={setCaixaId}
                options={[{ value: "todos", label: "Todos" }, ...caixas.map((c) => ({
                  value: c.id,
                  label: `${new Date(c.data_abertura).toLocaleDateString("pt-BR")} • ${c.status}`,
                }))]} />
              <SelectField label="Forma de pagamento" value={forma} onChange={setForma}
                options={[
                  { value: "todos", label: "Todas" },
                  ...Object.entries(FORMA_LABEL).map(([value, label]) => ({ value, label })),
                ]} />
              <SelectField label="Status pagamento" value={statusPag} onChange={setStatusPag}
                options={[
                  { value: "todos", label: "Todos" },
                  ...Object.entries(STATUS_PG_LABEL).map(([value, label]) => ({ value, label })),
                ]} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Listagem por dia */}
      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : grupos.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            Nenhuma venda encontrada para os filtros aplicados.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {grupos.map((g) => {
            const fechado = diasFechados[g.dia] ?? false;
            return (
              <Card key={g.dia}>
                <CardContent className="p-0">
                  <button
                    type="button"
                    onClick={() => toggleDia(g.dia)}
                    className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                  >
                    <div className="flex items-center gap-2">
                      {fechado ? (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="text-sm font-semibold capitalize">
                        {formatDateLong(g.dia)}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {g.vendasDia} {g.vendasDia === 1 ? "venda" : "vendas"}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                      <span>
                        Itens: <strong className="text-foreground tabular-nums">{g.qtdDia}</strong>
                      </span>
                      <span>
                        Total: <strong className="font-mono text-foreground tabular-nums">{formatBRL(g.totalDia)}</strong>
                      </span>
                      <span>
                        Custo: <strong className="font-mono tabular-nums">{formatBRL(g.custoDia)}</strong>
                      </span>
                      <span className={cn("font-mono tabular-nums", g.lucroDia >= 0 ? "text-success" : "text-destructive")}>
                        Lucro: <strong>{formatBRL(g.lucroDia)}</strong>
                      </span>
                    </div>
                  </button>

                  {!fechado && (
                    <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Produto</TableHead>
                          <TableHead className="text-right">Qtd</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead className="text-right">Custo</TableHead>
                          <TableHead className="text-right">Lucro</TableHead>
                          <TableHead>Vendas</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {g.produtos.map((p) => {
                          const lucro = p.total - p.custo;
                          return (
                            <TableRow
                              key={`${g.dia}-${p.produtoId}`}
                              className="cursor-pointer hover:bg-muted/40"
                              onClick={() =>
                                setProdutoDetalhe({
                                  id: p.produtoId,
                                  nome: p.produtoNome,
                                  rows: p.rows,
                                })
                              }
                            >
                              <TableCell>
                                <div className="font-medium">{p.produtoNome}</div>
                                {p.produtoSku && (
                                  <div className="text-xs text-muted-foreground">SKU: {p.produtoSku}</div>
                                )}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {p.quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
                              </TableCell>
                              <TableCell className="text-right font-mono tabular-nums">
                                {formatBRL(p.total)}
                              </TableCell>
                              <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                                {formatBRL(p.custo)}
                              </TableCell>
                              <TableCell
                                className={cn(
                                  "text-right font-mono tabular-nums",
                                  lucro >= 0 ? "text-success" : "text-destructive",
                                )}
                              >
                                {formatBRL(lucro)}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {Array.from(p.vendasNumeros).slice(0, 4).join(", ")}
                                {p.vendasNumeros.size > 4 ? ` +${p.vendasNumeros.size - 4}` : ""}
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
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Vendas canceladas não entram nos totais. Status do pagamento é informativo.
      </p>

      {/* Detalhe do produto */}
      <Dialog
        open={!!produtoDetalhe}
        onOpenChange={(o) => !o && setProdutoDetalhe(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              {produtoDetalhe?.nome}
            </DialogTitle>
            <DialogDescription>
              Vendas no período onde este produto apareceu.
            </DialogDescription>
          </DialogHeader>
          {produtoDetalhe && (
            <div className="max-h-[60vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Venda</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Pagamento</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {produtoDetalhe.rows.map((r) => (
                    <TableRow key={r.itemId}>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.dataEmissao.split("-").reverse().join("/")}
                      </TableCell>
                      <TableCell className="font-medium">{r.vendaNumero}</TableCell>
                      <TableCell className="text-sm">{r.clienteNome ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {r.formaPagamento ? FORMA_LABEL[r.formaPagamento] ?? r.formaPagamento : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {STATUS_PG_LABEL[r.vendaStatusPagamento] ?? r.vendaStatusPagamento}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatBRL(r.total)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setVendaSelecionada(r.vendaId);
                          }}
                        >
                          <Eye className="h-4 w-4" /> Abrir
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <DetalheVendaDialog
        open={!!vendaSelecionada}
        onOpenChange={(o) => !o && setVendaSelecionada(null)}
        vendaId={vendaSelecionada}
      />
    </div>
  );
}

function PresetBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      {label}
    </Button>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
