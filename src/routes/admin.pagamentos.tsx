import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Pencil, Trash2, Wallet } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useAdminPagamentos, useUpsertPagamento, useDeletePagamento,
  useAdminPlanos, useAdminModulos,
  type PagamentoRow, type PagamentoStatus, type PagamentoReferencia,
} from "@/hooks/useSaasAdmin";
import { useAdminEmpresas } from "@/hooks/useAdmin";

export const Route = createFileRoute("/admin/pagamentos")({
  head: () => ({ meta: [{ title: "Pagamentos — Master" }] }),
  component: PagamentosPage,
});

const fmtBRL = (n: number) =>
  Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function statusBadge(s: PagamentoStatus) {
  const map: Record<PagamentoStatus, string> = {
    pago: "bg-success/15 text-success hover:bg-success/15",
    pendente: "bg-amber-500/15 text-amber-700 hover:bg-amber-500/15 dark:text-amber-300",
    atrasado: "bg-destructive/15 text-destructive hover:bg-destructive/15",
    cancelado: "bg-muted text-muted-foreground hover:bg-muted",
  };
  return <Badge className={map[s]}>{s}</Badge>;
}

function PagamentosPage() {
  const { data = [], isLoading } = useAdminPagamentos();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<PagamentoRow | null>(null);
  const [del, setDel] = useState<PagamentoRow | null>(null);

  const totalPago = data.filter((p) => p.status === "pago").reduce((s, p) => s + Number(p.valor), 0);
  const totalPend = data.filter((p) => p.status === "pendente").reduce((s, p) => s + Number(p.valor), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pagamentos"
        description="Histórico de cobranças manuais por empresa."
        actions={
          <Button onClick={() => { setEdit(null); setOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Registrar pagamento
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Total recebido</p>
          <p className="mt-1 text-2xl font-semibold text-success">{fmtBRL(totalPago)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Em aberto</p>
          <p className="mt-1 text-2xl font-semibold text-amber-600">{fmtBRL(totalPend)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Total de lançamentos</p>
          <p className="mt-1 text-2xl font-semibold">{data.length}</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>Referência</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Pagamento</TableHead>
                <TableHead className="w-[120px] text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">Carregando…</TableCell></TableRow>
              ) : data.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="py-12 text-center">
                  <Wallet className="mx-auto h-8 w-8 text-muted-foreground/60" />
                  <p className="mt-2 text-sm text-muted-foreground">Nenhum pagamento registrado.</p>
                </TableCell></TableRow>
              ) : data.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.empresa_nome}</TableCell>
                  <TableCell className="text-sm">
                    <Badge variant="outline" className="mr-1">{p.referencia_tipo}</Badge>
                    {p.plano_nome ?? p.modulo_nome ?? p.descricao ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-medium">{fmtBRL(p.valor)}</TableCell>
                  <TableCell>{statusBadge(p.status)}</TableCell>
                  <TableCell className="text-sm">
                    {p.data_vencimento ? new Date(p.data_vencimento + "T00:00:00").toLocaleDateString("pt-BR") : "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {p.data_pagamento ? new Date(p.data_pagamento + "T00:00:00").toLocaleDateString("pt-BR") : "—"}
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

      <PagamentoDialog open={open} onOpenChange={setOpen} pagamento={edit} />

      <AlertDialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir pagamento?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <DeleteConfirm item={del} onDone={() => setDel(null)} />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DeleteConfirm({ item, onDone }: { item: PagamentoRow | null; onDone: () => void }) {
  const del = useDeletePagamento();
  return (
    <AlertDialogAction
      onClick={async () => { if (item) { await del.mutateAsync(item.id); onDone(); } }}
      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
    >
      Excluir
    </AlertDialogAction>
  );
}

function PagamentoDialog({
  open, onOpenChange, pagamento,
}: { open: boolean; onOpenChange: (o: boolean) => void; pagamento: PagamentoRow | null }) {
  const upsert = useUpsertPagamento();
  const { data: empresas = [] } = useAdminEmpresas();
  const { data: planos = [] } = useAdminPlanos();
  const { data: modulos = [] } = useAdminModulos();

  const [form, setForm] = useState({
    empresa_id: "", referencia_tipo: "plano" as PagamentoReferencia,
    plano_id: "__none__", modulo_id: "__none__",
    descricao: "", valor: 0, status: "pendente" as PagamentoStatus,
    forma_pagamento: "", data_vencimento: "", data_pagamento: "", observacoes: "",
  });

  if (open && pagamento && form.empresa_id !== pagamento.empresa_id) {
    setForm({
      empresa_id: pagamento.empresa_id,
      referencia_tipo: pagamento.referencia_tipo,
      plano_id: pagamento.plano_id ?? "__none__",
      modulo_id: pagamento.modulo_id ?? "__none__",
      descricao: pagamento.descricao ?? "",
      valor: Number(pagamento.valor),
      status: pagamento.status,
      forma_pagamento: pagamento.forma_pagamento ?? "",
      data_vencimento: pagamento.data_vencimento ?? "",
      data_pagamento: pagamento.data_pagamento ?? "",
      observacoes: pagamento.observacoes ?? "",
    });
  }
  if (open && !pagamento && form.empresa_id !== "" && form.descricao === "" && form.valor === 0) {
    // reset only when needed
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{pagamento ? "Editar pagamento" : "Registrar pagamento"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Empresa</Label>
              <Select value={form.empresa_id} onValueChange={(v) => setForm({ ...form, empresa_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                <SelectContent>
                  {empresas.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Referência</Label>
              <Select value={form.referencia_tipo} onValueChange={(v) => setForm({ ...form, referencia_tipo: v as PagamentoReferencia })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="plano">Plano</SelectItem>
                  <SelectItem value="modulo">Módulo</SelectItem>
                  <SelectItem value="outro">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {form.referencia_tipo === "plano" && (
            <div className="space-y-1.5">
              <Label>Plano</Label>
              <Select value={form.plano_id} onValueChange={(v) => setForm({ ...form, plano_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— nenhum —</SelectItem>
                  {planos.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {form.referencia_tipo === "modulo" && (
            <div className="space-y-1.5">
              <Label>Módulo</Label>
              <Select value={form.modulo_id} onValueChange={(v) => setForm({ ...form, modulo_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— nenhum —</SelectItem>
                  {modulos.map((m) => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Descrição</Label>
            <Input value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              placeholder="ex: Mensalidade outubro" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Valor</Label>
              <Input type="number" step="0.01" value={form.valor}
                onChange={(e) => setForm({ ...form, valor: Number(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as PagamentoStatus })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pendente">Pendente</SelectItem>
                  <SelectItem value="pago">Pago</SelectItem>
                  <SelectItem value="atrasado">Atrasado</SelectItem>
                  <SelectItem value="cancelado">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Forma</Label>
              <Input value={form.forma_pagamento}
                placeholder="PIX, boleto…"
                onChange={(e) => setForm({ ...form, forma_pagamento: e.target.value })} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Vencimento</Label>
              <Input type="date" value={form.data_vencimento}
                onChange={(e) => setForm({ ...form, data_vencimento: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Pago em</Label>
              <Input type="date" value={form.data_pagamento}
                onChange={(e) => setForm({ ...form, data_pagamento: e.target.value })} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Observações</Label>
            <Textarea rows={2} value={form.observacoes}
              onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            disabled={upsert.isPending || !form.empresa_id || !form.valor}
            onClick={async () => {
              await upsert.mutateAsync({
                id: pagamento?.id ?? null,
                empresa_id: form.empresa_id,
                referencia_tipo: form.referencia_tipo,
                plano_id: form.plano_id === "__none__" ? null : form.plano_id,
                modulo_id: form.modulo_id === "__none__" ? null : form.modulo_id,
                descricao: form.descricao.trim() || null,
                valor: Number(form.valor),
                status: form.status,
                forma_pagamento: form.forma_pagamento.trim() || null,
                data_vencimento: form.data_vencimento || null,
                data_pagamento: form.data_pagamento || null,
                observacoes: form.observacoes.trim() || null,
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
