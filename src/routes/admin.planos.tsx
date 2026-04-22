import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Pencil, Trash2, Package2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useAdminPlanos, useUpsertPlano, useDeletePlano,
  type Plano, type PlanoTipoCobranca,
} from "@/hooks/useSaasAdmin";

export const Route = createFileRoute("/admin/planos")({
  head: () => ({ meta: [{ title: "Planos — Master" }] }),
  component: PlanosPage,
});

const fmtBRL = (n: number) =>
  Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const tipoLabel: Record<PlanoTipoCobranca, string> = {
  mensal: "Mensal",
  anual: "Anual",
  vitalicio: "Vitalício",
};

function PlanosPage() {
  const { data = [], isLoading } = useAdminPlanos();
  const [edit, setEdit] = useState<Plano | null>(null);
  const [open, setOpen] = useState(false);
  const [del, setDel] = useState<Plano | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Planos"
        description="Catálogo de planos comerciais do SaaS."
        actions={
          <Button onClick={() => { setEdit(null); setOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Novo plano
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Cobrança</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-center">Limites</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[120px] text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">Carregando…</TableCell></TableRow>
              ) : data.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-12 text-center">
                  <Package2 className="mx-auto h-8 w-8 text-muted-foreground/60" />
                  <p className="mt-2 text-sm text-muted-foreground">Nenhum plano cadastrado.</p>
                </TableCell></TableRow>
              ) : data.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="font-medium">{p.nome}</div>
                    {p.descricao && <div className="text-xs text-muted-foreground">{p.descricao}</div>}
                  </TableCell>
                  <TableCell><Badge variant="outline">{tipoLabel[p.tipo_cobranca]}</Badge></TableCell>
                  <TableCell className="text-right font-medium">{fmtBRL(p.valor)}</TableCell>
                  <TableCell className="text-center text-xs text-muted-foreground">
                    {p.limite_usuarios ?? "∞"} usr · {p.limite_produtos ?? "∞"} prod
                  </TableCell>
                  <TableCell>
                    {p.ativo
                      ? <Badge className="bg-success/15 text-success hover:bg-success/15">Ativo</Badge>
                      : <Badge variant="secondary">Inativo</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => { setEdit(p); setOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDel(p)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <PlanoDialog open={open} onOpenChange={setOpen} plano={edit} />

      <AlertDialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir plano?</AlertDialogTitle>
            <AlertDialogDescription>
              Empresas com este plano ficarão sem plano vinculado. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <DeleteConfirm plano={del} onDone={() => setDel(null)} />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DeleteConfirm({ plano, onDone }: { plano: Plano | null; onDone: () => void }) {
  const del = useDeletePlano();
  return (
    <AlertDialogAction
      onClick={async () => { if (plano) { await del.mutateAsync(plano.id); onDone(); } }}
      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
    >
      Excluir
    </AlertDialogAction>
  );
}

function PlanoDialog({
  open, onOpenChange, plano,
}: { open: boolean; onOpenChange: (o: boolean) => void; plano: Plano | null }) {
  const upsert = useUpsertPlano();
  const [form, setForm] = useState({
    nome: "", descricao: "", valor: 0, tipo_cobranca: "mensal" as PlanoTipoCobranca,
    limite_usuarios: "" as string | number, limite_produtos: "" as string | number,
    ativo: true, ordem: 0,
  });

  // sync com plano
  if (open && plano && form.nome !== plano.nome) {
    setForm({
      nome: plano.nome,
      descricao: plano.descricao ?? "",
      valor: Number(plano.valor),
      tipo_cobranca: plano.tipo_cobranca,
      limite_usuarios: plano.limite_usuarios ?? "",
      limite_produtos: plano.limite_produtos ?? "",
      ativo: plano.ativo,
      ordem: plano.ordem,
    });
  }
  if (open && !plano && form.nome !== "") {
    setForm({ nome: "", descricao: "", valor: 0, tipo_cobranca: "mensal", limite_usuarios: "", limite_produtos: "", ativo: true, ordem: 0 });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{plano ? "Editar plano" : "Novo plano"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Descrição</Label>
            <Textarea rows={2} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Valor (R$)</Label>
              <Input type="number" step="0.01" value={form.valor}
                onChange={(e) => setForm({ ...form, valor: Number(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label>Cobrança</Label>
              <Select value={form.tipo_cobranca} onValueChange={(v) => setForm({ ...form, tipo_cobranca: v as PlanoTipoCobranca })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mensal">Mensal</SelectItem>
                  <SelectItem value="anual">Anual</SelectItem>
                  <SelectItem value="vitalicio">Vitalício</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Limite de usuários</Label>
              <Input type="number" placeholder="∞ ilimitado" value={form.limite_usuarios}
                onChange={(e) => setForm({ ...form, limite_usuarios: e.target.value === "" ? "" : Number(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label>Limite de produtos</Label>
              <Input type="number" placeholder="∞ ilimitado" value={form.limite_produtos}
                onChange={(e) => setForm({ ...form, limite_produtos: e.target.value === "" ? "" : Number(e.target.value) })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Ordem</Label>
              <Input type="number" value={form.ordem} onChange={(e) => setForm({ ...form, ordem: Number(e.target.value) })} />
            </div>
            <div className="flex items-end gap-3">
              <div className="flex items-center gap-2">
                <Switch checked={form.ativo} onCheckedChange={(c) => setForm({ ...form, ativo: c })} />
                <Label>Plano ativo</Label>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            disabled={upsert.isPending || !form.nome.trim()}
            onClick={async () => {
              await upsert.mutateAsync({
                id: plano?.id ?? null,
                nome: form.nome.trim(),
                descricao: form.descricao.trim() || null,
                valor: Number(form.valor) || 0,
                tipo_cobranca: form.tipo_cobranca,
                limite_usuarios: form.limite_usuarios === "" ? null : Number(form.limite_usuarios),
                limite_produtos: form.limite_produtos === "" ? null : Number(form.limite_produtos),
                ativo: form.ativo,
                ordem: Number(form.ordem) || 0,
              });
              onOpenChange(false);
            }}
          >
            {upsert.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
