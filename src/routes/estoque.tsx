import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowDownUp,
  AlertTriangle,
  Boxes,
  PackageX,
  Search,
  History,
  Loader2,
  ScanLine,
  ChevronDown,
  ChevronRight,
  CalendarDays,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { StatCard } from "@/components/shared/StatCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useProdutos } from "@/hooks/useProdutos";
import { useEstoqueSaldos, useMovimentacoes } from "@/hooks/useEstoque";
import { MovimentacaoDialog } from "@/components/estoque/MovimentacaoDialog";
import { EntradaPorCodigoDialog } from "@/components/scanner";

export const Route = createFileRoute("/estoque")({
  head: () => ({
    meta: [
      { title: "Estoque — Gestão Pro" },
      { name: "description", content: "Controle e movimentação de estoque." },
    ],
  }),
  component: StockPage,
});

function situacao(saldo: number, minimo: number) {
  if (saldo <= 0) return "Esgotado";
  if (saldo < minimo * 0.5) return "Crítico";
  if (saldo < minimo) return "Baixo";
  return "OK";
}

function StockPage() {
  const { data: produtos = [], isLoading } = useProdutos();
  const { data: saldos } = useEstoqueSaldos();
  const { data: movs = [] } = useMovimentacoes();
  const [open, setOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [movBusca, setMovBusca] = useState("");
  const [movDataIni, setMovDataIni] = useState("");
  const [movDataFim, setMovDataFim] = useState("");
  const [diasAbertosMov, setDiasAbertosMov] = useState<Record<string, boolean>>({});

  const items = useMemo(() => {
    return produtos.map((p) => {
      const saldo = Number(saldos?.get(p.id) ?? 0);
      const minimo = Number(p.estoque_minimo);
      return { ...p, saldo, minimo, situacao: situacao(saldo, minimo) };
    });
  }, [produtos, saldos]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) =>
      i.nome.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q)
    );
  }, [items, search]);

  const totalSkus = items.length;
  const totalUnits = items.reduce((s, i) => s + i.saldo, 0);
  const baixo = items.filter((i) => i.situacao === "Baixo" || i.situacao === "Crítico").length;
  const esgotados = items.filter((i) => i.situacao === "Esgotado").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Estoque"
        description="Acompanhe os níveis de estoque e o histórico de movimentações."
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setScanOpen(true)}>
              <ScanLine className="h-4 w-4" /> Entrada por leitura
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
              <ArrowDownUp className="h-4 w-4" /> Nova movimentação
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="SKUs cadastrados" value={String(totalSkus)} icon={Boxes} iconTone="primary" />
        <StatCard label="Unidades em estoque" value={totalUnits.toLocaleString("pt-BR")} icon={Boxes} iconTone="info" />
        <StatCard label="Estoque baixo" value={String(baixo)} icon={AlertTriangle} iconTone="warning" />
        <StatCard label="Esgotados" value={String(esgotados)} icon={PackageX} iconTone="danger" />
      </div>

      <Tabs defaultValue="posicao">
        <TabsList>
          <TabsTrigger value="posicao">Posição de estoque</TabsTrigger>
          <TabsTrigger value="historico">Histórico de movimentações</TabsTrigger>
        </TabsList>

        <TabsContent value="posicao" className="mt-4 space-y-4">
          <Card>
            <CardContent className="p-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Buscar produto..." className="pl-9"
                  value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    icon={Boxes}
                    title={produtos.length === 0 ? "Nenhum produto no estoque" : "Nada encontrado"}
                    description={produtos.length === 0
                      ? "Cadastre produtos para começar a controlar o estoque."
                      : "Ajuste sua busca para ver resultados."}
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead>Categoria</TableHead>
                      <TableHead className="text-right">Estoque atual</TableHead>
                      <TableHead className="text-right">Mínimo</TableHead>
                      <TableHead>Situação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell className="font-mono text-xs text-muted-foreground">{i.sku}</TableCell>
                        <TableCell className="font-medium">{i.nome}</TableCell>
                        <TableCell>
                          {i.categoria ? (
                            <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                              {i.categoria.nome}
                            </span>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{i.saldo}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{i.minimo}</TableCell>
                        <TableCell><StatusBadge status={i.situacao} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="historico" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Últimas movimentações</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {movs.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    icon={History}
                    title="Sem movimentações registradas"
                    description="Registre uma entrada, saída ou ajuste para começar."
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="text-right">Qtd</TableHead>
                      <TableHead className="text-right">Saldo após</TableHead>
                      <TableHead>Observação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movs.map((m) => {
                      const tipoLabel =
                        m.tipo === "entrada" ? "Entrada" :
                        m.tipo === "saida" ? "Saída" :
                        m.tipo === "ajuste" ? "Ajuste" :
                        m.tipo === "devolucao" ? "Devolução" : "Transferência";
                      const tone =
                        m.tipo === "entrada" || m.tipo === "devolucao" ? "success" :
                        m.tipo === "saida" || m.tipo === "transferencia" ? "danger" : "info";
                      return (
                        <TableRow key={m.id}>
                          <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                            {new Date(m.data_movimentacao).toLocaleString("pt-BR")}
                          </TableCell>
                          <TableCell className="font-medium">
                            {m.produto?.nome ?? "—"}
                            {m.produto?.sku && <span className="block text-xs font-mono text-muted-foreground">{m.produto.sku}</span>}
                          </TableCell>
                          <TableCell><StatusBadge status={tipoLabel} tone={tone as "success" | "danger" | "info"} /></TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{m.quantidade}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {m.saldo_posterior ?? "—"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                            {m.observacoes ?? "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <MovimentacaoDialog open={open} onOpenChange={setOpen} />
      <EntradaPorCodigoDialog open={scanOpen} onOpenChange={setScanOpen} />
    </div>
  );
}
