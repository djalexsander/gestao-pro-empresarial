import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Layers, ArrowRight, Lock, Search, PackageX, CheckCircle2 } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useAdminModos, useUpsertModo, useDeleteModo, useSetModoModulos,
  useAdminModulos, type SystemMode, type SystemModeTipo,
} from "@/hooks/useSaasAdmin";

export const Route = createFileRoute("/admin/modos")({
  head: () => ({ meta: [{ title: "Modos do sistema — Master" }] }),
  component: ModosPage,
});

function ModosPage() {
  const { data = [], isLoading } = useAdminModos();
  const [edit, setEdit] = useState<SystemMode | null>(null);
  const [open, setOpen] = useState(false);
  const [del, setDel] = useState<SystemMode | null>(null);
  const [vinculando, setVinculando] = useState<SystemMode | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Modos do sistema"
        description="Cada modo define um ambiente isolado (ERP, PDV, etc.) com seu próprio conjunto de módulos e rota inicial."
        actions={
          <Button onClick={() => { setEdit(null); setOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Novo modo
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Modo</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Rota inicial</TableHead>
                <TableHead>Módulos vinculados</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[180px] text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">Carregando…</TableCell></TableRow>
              ) : data.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-12 text-center">
                  <Layers className="mx-auto h-8 w-8 text-muted-foreground/60" />
                  <p className="mt-2 text-sm text-muted-foreground">Nenhum modo cadastrado.</p>
                </TableCell></TableRow>
              ) : data.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <div className="font-medium">{m.nome}</div>
                    <div className="text-xs text-muted-foreground font-mono">{m.chave}</div>
                    {m.descricao && (
                      <div className="mt-1 text-xs text-muted-foreground line-clamp-2 max-w-md">{m.descricao}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={m.tipo === "admin" ? "default" : "secondary"} className="gap-1">
                      {m.tipo === "admin" && <Lock className="h-3 w-3" />}
                      {m.tipo}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{m.rota_inicial}</code>
                  </TableCell>
                  <TableCell>
                    {m.modulos.length === 0 ? (
                      <span className="text-xs text-muted-foreground italic">nenhum</span>
                    ) : (
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {m.modulos.map((mod) => (
                          <Badge key={mod.id} variant="outline" className="text-[10px]">{mod.nome}</Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {m.ativo
                      ? <Badge className="bg-success/15 text-success hover:bg-success/15">Ativo</Badge>
                      : <Badge variant="secondary">Inativo</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setVinculando(m)} title="Vincular módulos">
                      <ArrowRight className="h-4 w-4" />
                    </Button>
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

      <ModoDialog open={open} onOpenChange={setOpen} modo={edit} />
      <VincularModulosDialog modo={vinculando} onClose={() => setVinculando(null)} />

      <AlertDialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir modo?</AlertDialogTitle>
            <AlertDialogDescription>
              Os vínculos deste modo com módulos serão removidos. Usuários que estiverem nele
              serão direcionados para a tela de escolha de modos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <DeleteConfirm modo={del} onDone={() => setDel(null)} />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DeleteConfirm({ modo, onDone }: { modo: SystemMode | null; onDone: () => void }) {
  const del = useDeleteModo();
  return (
    <AlertDialogAction
      onClick={async () => { if (modo) { await del.mutateAsync(modo.id); onDone(); } }}
      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
    >
      Excluir
    </AlertDialogAction>
  );
}

function ModoDialog({
  open, onOpenChange, modo,
}: { open: boolean; onOpenChange: (o: boolean) => void; modo: SystemMode | null }) {
  const upsert = useUpsertModo();
  const [form, setForm] = useState({
    nome: "", chave: "", descricao: "", rota_inicial: "/",
    tipo: "admin" as SystemModeTipo, ativo: true, ordem: 0, icone: "",
  });

  if (open && modo && form.nome !== modo.nome) {
    setForm({
      nome: modo.nome, chave: modo.chave, descricao: modo.descricao ?? "",
      rota_inicial: modo.rota_inicial, tipo: modo.tipo, ativo: modo.ativo,
      ordem: modo.ordem, icone: modo.icone ?? "",
    });
  }
  if (open && !modo && form.nome !== "") {
    setForm({
      nome: "", chave: "", descricao: "", rota_inicial: "/",
      tipo: "admin", ativo: true, ordem: 0, icone: "",
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{modo ? "Editar modo" : "Novo modo"}</DialogTitle>
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
                placeholder="ex: erp, pdv, mobile"
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
              <Label>Rota inicial</Label>
              <Input
                placeholder="/ ou /pos"
                value={form.rota_inicial}
                onChange={(e) => setForm({ ...form, rota_inicial: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v as SystemModeTipo })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin (requer senha)</SelectItem>
                  <SelectItem value="operador">Operador</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Ordem</Label>
              <Input type="number" value={form.ordem}
                onChange={(e) => setForm({ ...form, ordem: Number(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label>Ícone (opcional)</Label>
              <Input
                placeholder="LayoutDashboard, ShoppingCart…"
                value={form.icone}
                onChange={(e) => setForm({ ...form, icone: e.target.value })}
              />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Modo ativo</p>
              <p className="text-xs text-muted-foreground">Aparece na tela de escolha.</p>
            </div>
            <Switch checked={form.ativo} onCheckedChange={(c) => setForm({ ...form, ativo: c })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            disabled={upsert.isPending || !form.nome.trim() || !form.chave.trim() || !form.rota_inicial.trim()}
            onClick={async () => {
              await upsert.mutateAsync({
                id: modo?.id ?? null,
                nome: form.nome.trim(),
                chave: form.chave.trim(),
                descricao: form.descricao.trim() || null,
                rota_inicial: form.rota_inicial.trim(),
                tipo: form.tipo,
                ativo: form.ativo,
                ordem: Number(form.ordem) || 0,
                icone: form.icone.trim() || null,
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

function VincularModulosDialog({
  modo, onClose,
}: { modo: SystemMode | null; onClose: () => void }) {
  const open = !!modo;
  const { data: modulos = [] } = useAdminModulos();
  const set = useSetModoModulos();
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  if (open && modo && selecionados.size === 0 && modo.modulos.length > 0) {
    // Inicializa quando abrir (uma vez por abertura).
    setSelecionados(new Set(modo.modulos.map((m) => m.id)));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setSelecionados(new Set()); onClose(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Vincular módulos a “{modo?.nome}”</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto py-2">
          {modulos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum módulo cadastrado.</p>
          ) : modulos.map((m) => {
            const checked = selecionados.has(m.id);
            return (
              <label key={m.id} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/40">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) => {
                    const next = new Set(selecionados);
                    if (v) next.add(m.id); else next.delete(m.id);
                    setSelecionados(next);
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{m.nome}</p>
                    <code className="text-[10px] text-muted-foreground">{m.chave}</code>
                  </div>
                  {m.descricao && <p className="text-xs text-muted-foreground">{m.descricao}</p>}
                </div>
              </label>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setSelecionados(new Set()); onClose(); }}>
            Cancelar
          </Button>
          <Button
            disabled={set.isPending || !modo}
            onClick={async () => {
              if (!modo) return;
              await set.mutateAsync({
                mode_id: modo.id,
                module_ids: Array.from(selecionados),
              });
              setSelecionados(new Set());
              onClose();
            }}
          >
            {set.isPending ? "Salvando…" : "Salvar vínculos"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
