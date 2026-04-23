import { createFileRoute } from "@tanstack/react-router";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Loader2,
  PackagePlus,
  ScanLine,
  ChevronDown,
  ChevronRight,
  FolderTree,
} from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCategorias, useDeleteProduto, useProdutos } from "@/hooks/useProdutos";
import { useEstoqueSaldos } from "@/hooks/useEstoque";
import { ProdutoDialog } from "@/components/produtos/ProdutoDialog";
import { EntradaPorCodigoDialog } from "@/components/scanner";

export const Route = createFileRoute("/produtos")({
  head: () => ({
    meta: [
      { title: "Produtos — Gestão Pro" },
      { name: "description", content: "Cadastro e gestão de produtos do catálogo." },
    ],
  }),
  component: ProductsPage,
});

const formatBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function ProductsPage() {
  const { data: produtos = [], isLoading } = useProdutos();
  const { data: categorias = [] } = useCategorias();
  const { data: saldos } = useEstoqueSaldos();
  const deleteMut = useDeleteProduto();

  const [open, setOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoriaFilter, setCategoriaFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [gruposAbertos, setGruposAbertos] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return produtos.filter((p) => {
      if (q && !p.nome.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) return false;
      if (categoriaFilter !== "all" && p.categoria_id !== categoriaFilter) return false;
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      return true;
    });
  }, [produtos, search, categoriaFilter, statusFilter]);

  const gruposPorCategoria = useMemo(() => {
    const mapa = new Map<string, { nome: string; produtos: typeof filtered }>();
    for (const p of filtered) {
      const key = p.categoria_id ?? "_sem";
      const nome = p.categoria?.nome ?? "Sem categoria";
      if (!mapa.has(key)) mapa.set(key, { nome, produtos: [] as typeof filtered });
      mapa.get(key)!.produtos.push(p);
    }
    return Array.from(mapa.entries())
      .map(([key, g]) => ({ key, nome: g.nome, produtos: g.produtos }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [filtered]);

  function toggleGrupo(key: string) {
    setGruposAbertos((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function openNew() { setEditingId(null); setOpen(true); }
  function openEdit(id: string) { setEditingId(id); setOpen(true); }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Produtos"
        description="Catálogo de produtos da empresa."
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setScanOpen(true)}>
              <ScanLine className="h-4 w-4" /> Entrada por leitura
            </Button>
            <Button size="sm" className="gap-1.5" onClick={openNew}>
              <Plus className="h-4 w-4" /> Novo produto
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar por SKU ou nome..." className="pl-9"
                value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={categoriaFilter} onValueChange={setCategoriaFilter}>
              <SelectTrigger className="w-full sm:w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas categorias</SelectItem>
                {categorias.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos status</SelectItem>
                <SelectItem value="ativo">Ativo</SelectItem>
                <SelectItem value="inativo">Inativo</SelectItem>
                <SelectItem value="descontinuado">Descontinuado</SelectItem>
              </SelectContent>
            </Select>
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
                icon={PackagePlus}
                title={produtos.length === 0 ? "Nenhum produto cadastrado" : "Nenhum produto encontrado"}
                description={produtos.length === 0
                  ? "Comece cadastrando seu primeiro produto no catálogo."
                  : "Tente ajustar os filtros de busca."}
                action={produtos.length === 0 ? (
                  <Button onClick={openNew} className="gap-1.5">
                    <Plus className="h-4 w-4" /> Cadastrar produto
                  </Button>
                ) : undefined}
              />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {gruposPorCategoria.map((grupo) => {
                const aberto = gruposAbertos[grupo.key] ?? false;
                return (
                  <div key={grupo.key}>
                    <button
                      type="button"
                      onClick={() => toggleGrupo(grupo.key)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                    >
                      <div className="flex items-center gap-2">
                        {aberto ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        <FolderTree className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium text-foreground">
                          {grupo.nome}
                        </span>
                        <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {grupo.produtos.length}{" "}
                          {grupo.produtos.length === 1 ? "produto" : "produtos"}
                        </span>
                      </div>
                    </button>
                    {aberto && (
                      <div className="bg-muted/20 px-2 pb-3">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>SKU</TableHead>
                              <TableHead>Nome</TableHead>
                              <TableHead className="text-right">Custo</TableHead>
                              <TableHead className="text-right">Venda</TableHead>
                              <TableHead className="text-right">Estoque</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead className="w-20" />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {grupo.produtos.map((p) => {
                              const saldo = Number(saldos?.get(p.id) ?? 0);
                              const statusLabel =
                                p.status === "ativo"
                                  ? "Ativo"
                                  : p.status === "inativo"
                                    ? "Inativo"
                                    : "Descontinuado";
                              return (
                                <TableRow key={p.id}>
                                  <TableCell className="font-mono text-xs text-muted-foreground">
                                    {p.sku}
                                  </TableCell>
                                  <TableCell className="font-medium">{p.nome}</TableCell>
                                  <TableCell className="text-right text-muted-foreground">
                                    {formatBRL(Number(p.preco_custo))}
                                  </TableCell>
                                  <TableCell className="text-right font-medium">
                                    {formatBRL(Number(p.preco_venda))}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {saldo}
                                  </TableCell>
                                  <TableCell>
                                    <StatusBadge status={statusLabel} />
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex items-center justify-end gap-1">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={() => openEdit(p.id)}
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-destructive"
                                        onClick={() => setConfirmDelete(p.id)}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <ProdutoDialog open={open} onOpenChange={setOpen} produtoId={editingId} />
      <EntradaPorCodigoDialog open={scanOpen} onOpenChange={setScanOpen} />

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir produto?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O histórico de movimentações será preservado, mas o produto será removido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmDelete) deleteMut.mutate(confirmDelete);
                setConfirmDelete(null);
              }}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
