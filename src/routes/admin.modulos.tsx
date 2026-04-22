import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Pencil, Trash2, Puzzle, Lock } from "lucide-react";
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
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useAdminModulos, useUpsertModulo, useDeleteModulo, type Modulo,
} from "@/hooks/useSaasAdmin";

export const Route = createFileRoute("/admin/modulos")({
  head: () => ({ meta: [{ title: "Módulos — Master" }] }),
  component: ModulosPage,
});

const fmtBRL = (n: number) =>
  Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function ModulosPage() {
  const { data = [], isLoading } = useAdminModulos();
  const [edit, setEdit] = useState<Modulo | null>(null);
  const [open, setOpen] = useState(false);
  const [del, setDel] = useState<Modulo | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Módulos adicionais"
        description="Funcionalidades extras pagas que podem ser ativadas por empresa."
        actions={
          <Button onClick={() => { setEdit(null); setOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Novo módulo
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Chave</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-center">Restringe</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[120px] text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">Carregando…</TableCell></TableRow>
              ) : data.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-12 text-center">
                  <Puzzle className="mx-auto h-8 w-8 text-muted-foreground/60" />
                  <p className="mt-2 text-sm text-muted-foreground">Nenhum módulo cadastrado.</p>
                </TableCell></TableRow>
              ) : data.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <div className="font-medium">{m.nome}</div>
                    {m.descricao && <div className="text-xs text-muted-foreground">{m.descricao}</div>}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{m.chave}</TableCell>
                  <TableCell className="text-right font-medium">{fmtBRL(m.valor)}</TableCell>
                  <TableCell className="text-center">
                    {m.aplica_restricao
                      ? <Badge variant="outline" className="gap-1"><Lock className="h-3 w-3" />Sim</Badge>
                      : <span className="text-xs text-muted-foreground">Não</span>}
                  </TableCell>
                  <TableCell>
                    {m.ativo
                      ? <Badge className="bg-success/15 text-success hover:bg-success/15">Ativo</Badge>
                      : <Badge variant="secondary">Inativo</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => { setEdit(m); setOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDel(m)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ModuloDialog open={open} onOpenChange={setOpen} modulo={edit} />

      <AlertDialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir módulo?</AlertDialogTitle>
            <AlertDialogDescription>
              Todos os vínculos deste módulo com empresas serão removidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <DeleteConfirm modulo={del} onDone={() => setDel(null)} />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DeleteConfirm({ modulo, onDone }: { modulo: Modulo | null; onDone: () => void }) {
  const del = useDeleteModulo();
  return (
    <AlertDialogAction
      onClick={async () => { if (modulo) { await del.mutateAsync(modulo.id); onDone(); } }}
      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
    >
      Excluir
    </AlertDialogAction>
  );
}

function ModuloDialog({
  open, onOpenChange, modulo,
}: { open: boolean; onOpenChange: (o: boolean) => void; modulo: Modulo | null }) {
  const upsert = useUpsertModulo();
  const [form, setForm] = useState({
    nome: "", chave: "", descricao: "", valor: 0, ativo: true, aplica_restricao: false, ordem: 0,
  });

  if (open && modulo && form.nome !== modulo.nome) {
    setForm({
      nome: modulo.nome, chave: modulo.chave, descricao: modulo.descricao ?? "",
      valor: Number(modulo.valor), ativo: modulo.ativo,
      aplica_restricao: modulo.aplica_restricao, ordem: modulo.ordem,
    });
  }
  if (open && !modulo && form.nome !== "") {
    setForm({ nome: "", chave: "", descricao: "", valor: 0, ativo: true, aplica_restricao: false, ordem: 0 });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{modulo ? "Editar módulo" : "Novo módulo"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Chave técnica</Label>
              <Input
                placeholder="ex: nfe, delivery"
                value={form.chave}
                onChange={(e) => setForm({ ...form, chave: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
              />
            </div>
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
              <Label>Ordem</Label>
              <Input type="number" value={form.ordem}
                onChange={(e) => setForm({ ...form, ordem: Number(e.target.value) })} />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Aplica restrição real</p>
              <p className="text-xs text-muted-foreground">
                Se ativado, o módulo bloqueia funcionalidades no ERP quando não contratado.
              </p>
            </div>
            <Switch checked={form.aplica_restricao} onCheckedChange={(c) => setForm({ ...form, aplica_restricao: c })} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Módulo ativo</p>
              <p className="text-xs text-muted-foreground">Aparece para contratação.</p>
            </div>
            <Switch checked={form.ativo} onCheckedChange={(c) => setForm({ ...form, ativo: c })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            disabled={upsert.isPending || !form.nome.trim() || !form.chave.trim()}
            onClick={async () => {
              await upsert.mutateAsync({
                id: modulo?.id ?? null,
                nome: form.nome.trim(),
                chave: form.chave.trim(),
                descricao: form.descricao.trim() || null,
                valor: Number(form.valor) || 0,
                ativo: form.ativo,
                aplica_restricao: form.aplica_restricao,
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
