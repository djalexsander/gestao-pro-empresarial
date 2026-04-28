import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Search, Pencil, Trash2, Lock, Unlock, Ban, Building2,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import {
  useAdminEmpresas, useDeleteEmpresa, useSetEmpresaStatus,
  type AdminEmpresa, type EmpresaStatus,
} from "@/hooks/useAdmin";
import { EmpresaDialog } from "@/components/admin/EmpresaDialog";
import { EmpresaStatusBadge, PlanoBadge } from "@/components/admin/StatusBadges";

export const Route = createFileRoute("/admin/empresas")({
  head: () => ({ meta: [{ title: "Empresas — Painel Master" }] }),
  component: AdminEmpresasPage,
});

const fmtBRL = (n: number) =>
  Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function AdminEmpresasPage() {
  const { data: empresas = [], isLoading } = useAdminEmpresas();
  const setStatus = useSetEmpresaStatus();
  const del = useDeleteEmpresa();

  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState<"todos" | EmpresaStatus>("todos");
  const [editando, setEditando] = useState<AdminEmpresa | null>(null);
  const [removendo, setRemovendo] = useState<AdminEmpresa | null>(null);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return empresas.filter((e) => {
      if (statusFiltro !== "todos" && e.status !== statusFiltro) return false;
      if (!q) return true;
      return (
        e.nome.toLowerCase().includes(q) ||
        (e.email ?? "").toLowerCase().includes(q) ||
        (e.documento ?? "").toLowerCase().includes(q)
      );
    });
  }, [empresas, busca, statusFiltro]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Empresas da plataforma"
        description="Gestão SaaS: edite dados cadastrais, plano, ative, bloqueie ou exclua empresas."
      />

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, e-mail ou documento..."
                className="pl-9"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
            <Select value={statusFiltro} onValueChange={(v) => setStatusFiltro(v as typeof statusFiltro)}>
              <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                <SelectItem value="ativa">Ativas</SelectItem>
                <SelectItem value="inativa">Inativas</SelectItem>
                <SelectItem value="bloqueada">Bloqueadas</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead className="text-right">Usuários</TableHead>
                <TableHead>Cadastro</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Carregando...</TableCell></TableRow>
              )}
              {!isLoading && filtradas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                    <Building2 className="mx-auto mb-2 h-8 w-8 opacity-50" />
                    Nenhuma empresa encontrada.
                  </TableCell>
                </TableRow>
              )}
              {filtradas.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <div className="font-medium">{e.nome}</div>
                    <div className="text-xs text-muted-foreground">
                      {e.email ?? "—"}
                      {e.documento && <span className="ml-2 font-mono">{e.documento}</span>}
                    </div>
                  </TableCell>
                  <TableCell><EmpresaStatusBadge status={e.status} /></TableCell>
                  <TableCell><PlanoBadge plano={e.plano} /></TableCell>
                  <TableCell className="text-right tabular-nums">{e.total_usuarios}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(e.created_at).toLocaleDateString("pt-BR")}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel>Ações</DropdownMenuLabel>
                        <DropdownMenuItem onSelect={() => setEditando(e)}>
                          <Pencil className="mr-2 h-4 w-4" /> Editar dados
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {e.status !== "ativa" && (
                          <DropdownMenuItem
                            disabled={setStatus.isPending}
                            onSelect={() => setStatus.mutate({ id: e.id, status: "ativa" })}
                          >
                            <Unlock className="mr-2 h-4 w-4 text-success" /> Ativar
                          </DropdownMenuItem>
                        )}
                        {e.status !== "inativa" && (
                          <DropdownMenuItem
                            disabled={setStatus.isPending}
                            onSelect={() => setStatus.mutate({ id: e.id, status: "inativa" })}
                          >
                            <Lock className="mr-2 h-4 w-4" /> Inativar
                          </DropdownMenuItem>
                        )}
                        {e.status !== "bloqueada" && (
                          <DropdownMenuItem
                            disabled={setStatus.isPending}
                            onSelect={() => setStatus.mutate({
                              id: e.id, status: "bloqueada",
                              motivo: "Bloqueio manual via painel master",
                            })}
                          >
                            <Ban className="mr-2 h-4 w-4 text-destructive" /> Bloquear
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onSelect={() => setRemovendo(e)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> Excluir empresa
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <EmpresaDialog
        empresa={editando}
        open={!!editando}
        onClose={() => setEditando(null)}
      />

      <AlertDialog open={!!removendo} onOpenChange={(o) => !o && setRemovendo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir empresa?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação remove permanentemente a empresa <strong>{removendo?.nome}</strong> e
              <strong> todos os dados</strong> dela (produtos, clientes, vendas, compras, financeiro).
              Não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (removendo) del.mutate(removendo.id);
                setRemovendo(null);
              }}
            >
              Excluir tudo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
