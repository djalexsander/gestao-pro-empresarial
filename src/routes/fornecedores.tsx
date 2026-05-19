import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Search, Pencil, Trash2, Users, ShoppingCart, CircleDollarSign, Clock } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { StatCard } from "@/components/shared/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
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
import { useDeleteFornecedor, useFornecedores, type Fornecedor } from "@/hooks/useFornecedores";
import { useFornecedorMetricas } from "@/hooks/useCompras";
import { FornecedorDialog } from "@/components/fornecedores/FornecedorDialog";

export const Route = createFileRoute("/fornecedores")({
  head: () => ({
    meta: [
      { title: "Fornecedores — Gestão Pro" },
      { name: "description", content: "Cadastro de fornecedores da empresa." },
    ],
  }),
  component: SuppliersPage,
});

const fmtBRL = (n: number) =>
  Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function SuppliersPage() {
  const { data: fornecedores = [], isLoading } = useFornecedores();
  const { data: metricasMap } = useFornecedorMetricas();
  const deleteMut = useDeleteFornecedor();

  const [busca, setBusca] = useState("");
  const [editing, setEditing] = useState<Fornecedor | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [removendo, setRemovendo] = useState<Fornecedor | null>(null);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return fornecedores;
    return fornecedores.filter(
      (f) =>
        f.razao_social.toLowerCase().includes(q) ||
        f.nome_fantasia?.toLowerCase().includes(q) ||
        f.documento?.toLowerCase().includes(q) ||
        f.email?.toLowerCase().includes(q),
    );
  }, [fornecedores, busca]);

  const stats = useMemo(() => {
    const total = fornecedores.length;
    const ativos = fornecedores.filter((f) => f.status === "ativo").length;
    let valor = 0;
    let aberto = 0;
    if (metricasMap) {
      for (const m of metricasMap.values()) {
        valor += Number(m.valor_total ?? 0);
        aberto += Number(m.compras_em_aberto ?? 0);
      }
    }
    return { total, ativos, valor, aberto };
  }, [fornecedores, metricasMap]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fornecedores"
        description="Cadastre e acompanhe seus parceiros comerciais — com histórico de compras."
        actions={
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Novo fornecedor
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total cadastrados" value={String(stats.total)} icon={Users} />
        <StatCard label="Ativos" value={String(stats.ativos)} icon={Users} iconTone="success" />
        <StatCard
          label="Compras em aberto"
          value={String(stats.aberto)}
          icon={Clock}
          iconTone="warning"
        />
        <StatCard
          label="Total comprado"
          value={fmtBRL(stats.valor)}
          icon={CircleDollarSign}
          iconTone="info"
        />
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, documento ou e-mail..."
              className="pl-9"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Razão social / Nome</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Cidade/UF</TableHead>
                <TableHead className="text-right">
                  <ShoppingCart className="inline h-3.5 w-3.5" /> Compras
                </TableHead>
                <TableHead className="text-right">Total comprado</TableHead>
                <TableHead>Última compra</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filtrados.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                    Nenhum fornecedor cadastrado.
                  </TableCell>
                </TableRow>
              )}
              {filtrados.map((f) => {
                const m = metricasMap?.get(f.id);
                const totalCompras = Number(m?.total_compras ?? 0);
                const valor = Number(m?.valor_total ?? 0);
                const aberto = Number(m?.compras_em_aberto ?? 0);
                return (
                  <TableRow key={f.id}>
                    <TableCell>
                      <div className="font-medium">{f.razao_social}</div>
                      {f.nome_fantasia && (
                        <div className="text-xs text-muted-foreground">{f.nome_fantasia}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {f.documento ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {[f.cidade, f.estado].filter(Boolean).join(" / ") || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {totalCompras}
                      {aberto > 0 && (
                        <span className="ml-1 text-xs text-warning">({aberto} em aberto)</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {fmtBRL(valor)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {m?.ultima_compra
                        ? new Date(m.ultima_compra).toLocaleDateString("pt-BR")
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={f.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => {
                            setEditing(f);
                            setDialogOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => setRemovendo(f)}
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
        </CardContent>
      </Card>

      <FornecedorDialog open={dialogOpen} onOpenChange={setDialogOpen} fornecedor={editing} />

      <AlertDialog open={!!removendo} onOpenChange={(o) => !o && setRemovendo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Inativar fornecedor?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{removendo?.razao_social}</strong> será marcado como inativo e deixará de
              aparecer para novas compras. As compras já registradas continuam vinculadas ao
              fornecedor e o histórico é preservado. Você pode reativá-lo depois pelo filtro de
              status.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (removendo) deleteMut.mutate(removendo.id);
                setRemovendo(null);
              }}
            >
              Inativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
