import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Search, Trash2, ShieldCheck, Shield, UserCheck, UserX } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useAdminUsers, useDeleteAdminUser, useSetUserRole, type AppRole, type AdminUser } from "@/hooks/useAdmin";
import { useAuth } from "@/components/auth/AuthProvider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/admin/usuarios")({
  head: () => ({
    meta: [{ title: "Usuários — Painel Master" }],
  }),
  component: AdminUsersPage,
});

const ROLES: { value: AppRole; label: string; description: string }[] = [
  { value: "super_admin", label: "Super Admin", description: "Acesso total ao painel master" },
  { value: "admin", label: "Admin", description: "Administrador da empresa" },
  { value: "gerente", label: "Gerente", description: "Gerenciamento operacional" },
  { value: "vendedor", label: "Vendedor", description: "Acesso a vendas" },
  { value: "financeiro", label: "Financeiro", description: "Acesso ao financeiro" },
];

function AdminUsersPage() {
  const { user: current } = useAuth();
  const { data: users = [], isLoading } = useAdminUsers();
  const deleteUser = useDeleteAdminUser();

  const [busca, setBusca] = useState("");
  const [removendo, setRemovendo] = useState<AdminUser | null>(null);
  const [editandoRoles, setEditandoRoles] = useState<AdminUser | null>(null);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.email?.toLowerCase().includes(q));
  }, [users, busca]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usuários da plataforma"
        description="Gestão de contas, papéis e acesso. Você não vê o conteúdo das empresas."
      />

      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por e-mail..."
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
                <TableHead>E-mail</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Papéis</TableHead>
                <TableHead>Cadastro</TableHead>
                <TableHead>Último acesso</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filtrados.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                    Nenhum usuário encontrado.
                  </TableCell>
                </TableRow>
              )}
              {filtrados.map((u) => {
                const isMe = current?.id === u.user_id;
                const isSuper = u.roles.includes("super_admin");
                return (
                  <TableRow key={u.user_id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {isSuper ? (
                          <ShieldCheck className="h-4 w-4 text-primary" />
                        ) : u.email_confirmed ? (
                          <UserCheck className="h-4 w-4 text-success" />
                        ) : (
                          <UserX className="h-4 w-4 text-muted-foreground" />
                        )}
                        <div>
                          <div className="font-medium">{u.email}</div>
                          {isMe && <div className="text-xs text-primary">você</div>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {u.empresa_nome ? (
                        <div>
                          <div className="text-sm font-medium">{u.empresa_nome}</div>
                          <div className="text-xs text-muted-foreground">
                            {u.empresa_status} · {u.empresa_plano}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs italic text-muted-foreground">sem empresa</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {u.roles.length === 0 ? (
                          <span className="text-xs text-muted-foreground italic">sem papel</span>
                        ) : (
                          u.roles.map((r) => (
                            <Badge
                              key={r}
                              variant={r === "super_admin" ? "default" : "secondary"}
                              className="text-xs"
                            >
                              {r}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(u.created_at).toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {u.last_sign_in_at
                        ? new Date(u.last_sign_in_at).toLocaleDateString("pt-BR")
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{u.total_produtos}</TableCell>
                    <TableCell className="text-right tabular-nums">{u.total_vendas}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Gerenciar papéis"
                          onClick={() => setEditandoRoles(u)}
                        >
                          <Shield className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive disabled:opacity-30"
                          title={isMe ? "Você não pode excluir sua própria conta" : "Excluir usuário"}
                          disabled={isMe}
                          onClick={() => setRemovendo(u)}
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

      <RolesDialog
        user={editandoRoles}
        onClose={() => setEditandoRoles(null)}
        currentUserId={current?.id}
      />

      <AlertDialog open={!!removendo} onOpenChange={(o) => !o && setRemovendo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuário?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação remove permanentemente <strong>{removendo?.email}</strong> e
              <strong> todos os dados</strong> da empresa dele (produtos, clientes, vendas,
              compras, financeiro). Não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (removendo) deleteUser.mutate(removendo.user_id);
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

function RolesDialog({
  user,
  onClose,
  currentUserId,
}: {
  user: AdminUser | null;
  onClose: () => void;
  currentUserId?: string;
}) {
  const setRole = useSetUserRole();
  const open = !!user;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Gerenciar papéis</DialogTitle>
          <DialogDescription>{user?.email}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {ROLES.map((r) => {
            const has = user?.roles.includes(r.value) ?? false;
            const isSelf = user?.user_id === currentUserId;
            const blockSelfRevoke = isSelf && r.value === "super_admin" && has;
            return (
              <div
                key={r.value}
                className="flex items-center justify-between rounded-lg border border-border p-3"
              >
                <div className="min-w-0 flex-1">
                  <Label className="text-sm font-medium">{r.label}</Label>
                  <p className="text-xs text-muted-foreground">{r.description}</p>
                </div>
                <Switch
                  checked={has}
                  disabled={blockSelfRevoke || setRole.isPending}
                  onCheckedChange={(checked) => {
                    if (!user) return;
                    setRole.mutate({
                      userId: user.user_id,
                      role: r.value,
                      grant: checked,
                    });
                  }}
                />
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
