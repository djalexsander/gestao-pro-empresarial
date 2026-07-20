import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Pencil, ShieldCheck, Puzzle } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  useAdminAssinaturas, useSetAssinatura, useAdminPlanos, useAdminModulos,
  useEmpresaModulos, useSetEmpresaModulo, useRemoverEmpresaModulo,
  useAdminPrecoAssinatura, useAdminSetPrecoAssinatura,
  useAdminPrecosModulos, useAdminSetPrecoModulo,
  type AssinaturaRow, type AssinaturaStatus, type EmpresaModuloStatus,
} from "@/hooks/useSaasAdmin";

export const Route = createFileRoute("/admin/assinaturas")({
  head: () => ({ meta: [{ title: "Assinaturas — Master" }] }),
  component: AssinaturasPage,
});

const fmtBRL = (n: number | null) =>
  Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function statusBadge(s: string) {
  const map: Record<string, string> = {
    trial: "bg-info/15 text-info hover:bg-info/15",
    ativo: "bg-success/15 text-success hover:bg-success/15",
    vencido: "bg-destructive/15 text-destructive hover:bg-destructive/15",
    cancelado: "bg-muted text-muted-foreground hover:bg-muted",
  };
  return <Badge className={map[s] ?? "bg-muted"}>{s}</Badge>;
}

function AssinaturasPage() {
  const { data = [], isLoading } = useAdminAssinaturas();
  const [edit, setEdit] = useState<AssinaturaRow | null>(null);
  const [modulosFor, setModulosFor] = useState<AssinaturaRow | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assinaturas"
        description="Plano vigente, status e módulos ativos por empresa."
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead className="text-center">Módulos</TableHead>
                <TableHead className="w-[160px] text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">Carregando…</TableCell></TableRow>
              ) : data.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-12 text-center">
                  <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground/60" />
                  <p className="mt-2 text-sm text-muted-foreground">Nenhuma empresa.</p>
                </TableCell></TableRow>
              ) : data.map((a) => (
                <TableRow key={a.empresa_id}>
                  <TableCell>
                    <div className="font-medium">{a.empresa_nome}</div>
                    {a.empresa_status && (
                      <div className="text-xs text-muted-foreground">empresa: {a.empresa_status}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    {a.plano_nome ? (
                      <div>
                        <div className="font-medium">{a.plano_nome}</div>
                        <div className="text-xs text-muted-foreground">
                          {fmtBRL(a.plano_valor)} / {a.plano_tipo}
                        </div>
                      </div>
                    ) : <span className="text-xs text-muted-foreground">— sem plano —</span>}
                  </TableCell>
                  <TableCell>{statusBadge(a.status_efetivo)}</TableCell>
                  <TableCell className="text-sm">
                    {a.data_expiracao
                      ? <>
                          {new Date(a.data_expiracao + "T00:00:00").toLocaleDateString("pt-BR")}
                          <div className={`text-xs ${a.dias_restantes < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                            {a.dias_restantes >= 0 ? `${a.dias_restantes} dias` : `${Math.abs(a.dias_restantes)} dias atrás`}
                          </div>
                        </>
                      : <span className="text-xs text-muted-foreground">sem expiração</span>}
                  </TableCell>
                  <TableCell className="text-center">
                    <Button variant="ghost" size="sm" onClick={() => setModulosFor(a)}>
                      <Puzzle className="mr-1 h-4 w-4" /> {a.modulos_ativos}
                    </Button>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setEdit(a)}>
                      <Pencil className="mr-2 h-3.5 w-3.5" /> Editar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {edit && <EditAssinaturaDialog assinatura={edit} onClose={() => setEdit(null)} />}
      {modulosFor && <EmpresaModulosDialog assinatura={modulosFor} onClose={() => setModulosFor(null)} />}
    </div>
  );
}

function EditAssinaturaDialog({
  assinatura, onClose,
}: { assinatura: AssinaturaRow; onClose: () => void }) {
  const { data: planos = [] } = useAdminPlanos();
  const set = useSetAssinatura();
  const setPreco = useAdminSetPrecoAssinatura();
  const { data: preco } = useAdminPrecoAssinatura(assinatura.empresa_id);
  const [form, setForm] = useState({
    plano_id: assinatura.plano_id ?? "__none__",
    status: (assinatura.status ?? "trial") as AssinaturaStatus,
    data_inicio: assinatura.data_inicio ?? "",
    data_expiracao: assinatura.data_expiracao ?? "",
    observacoes: assinatura.observacoes ?? "",
    valor_contratado: "",
    valor_personalizado: false,
  });

  useEffect(() => {
    if (!preco) return;
    setForm((current) => ({
      ...current,
      valor_contratado: String(preco.valor_contratado ?? ""),
      valor_personalizado: preco.valor_personalizado,
    }));
  }, [preco]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assinatura — {assinatura.empresa_nome}</DialogTitle>
          <DialogDescription>Defina plano, status e datas.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-1.5">
            <Label>Plano</Label>
            <Select value={form.plano_id} onValueChange={(v) => setForm({ ...form, plano_id: v })}>
              <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— sem plano —</SelectItem>
                {planos.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nome} · {fmtBRL(p.valor)}/{p.tipo_cobranca}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as AssinaturaStatus })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="trial">Trial</SelectItem>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="vencido">Vencido</SelectItem>
                  <SelectItem value="cancelado">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Início</Label>
              <Input type="date" value={form.data_inicio}
                onChange={(e) => setForm({ ...form, data_inicio: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Expiração</Label>
              <Input type="date" value={form.data_expiracao}
                onChange={(e) => setForm({ ...form, data_expiracao: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Observações</Label>
            <Textarea rows={2} value={form.observacoes}
              onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
          </div>
          <div className="space-y-3 rounded-lg border p-3">
            <div className="space-y-1.5">
              <Label>Valor contratado</Label>
              <Input type="number" min="0" step="0.01" value={form.valor_contratado}
                onChange={(e) => setForm({ ...form, valor_contratado: e.target.value })} />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="valor-personalizado-plano" checked={form.valor_personalizado}
                onCheckedChange={(checked) => setForm({ ...form, valor_personalizado: checked === true })} />
              <Label htmlFor="valor-personalizado-plano">Valor personalizado</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Assinaturas com valor personalizado nao participam de reajustes em massa.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={set.isPending}
            onClick={async () => {
              await set.mutateAsync({
                empresa_id: assinatura.empresa_id,
                plano_id: form.plano_id === "__none__" ? null : form.plano_id,
                status: form.status,
                data_inicio: form.data_inicio || null,
                data_expiracao: form.data_expiracao || null,
                observacoes: form.observacoes.trim() || null,
              });
              const valor = Number(form.valor_contratado.replace(",", "."));
              if (!Number.isFinite(valor) || valor < 0) throw new Error("Informe um valor contratado valido.");
              await setPreco.mutateAsync({
                empresa_id: assinatura.empresa_id,
                valor,
                personalizado: form.valor_personalizado,
              });
              onClose();
            }}
          >
            {set.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmpresaModulosDialog({
  assinatura, onClose,
}: { assinatura: AssinaturaRow; onClose: () => void }) {
  const { data: modulos = [] } = useAdminModulos();
  const { data: ativos = [] } = useEmpresaModulos(assinatura.empresa_id);
  const { data: precos = [] } = useAdminPrecosModulos(assinatura.empresa_id);
  const setMod = useSetEmpresaModulo();
  const removeMod = useRemoverEmpresaModulo();

  const ativosMap = new Map(ativos.map((a) => [a.modulo_id, a]));
  const precosMap = new Map(precos.map((p) => [p.modulo_id, p]));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Módulos — {assinatura.empresa_nome}</DialogTitle>
          <DialogDescription>Ative ou desative módulos adicionais para esta empresa.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto py-2">
          {modulos.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhum módulo cadastrado ainda.</p>
          ) : modulos.map((m) => {
            const atual = ativosMap.get(m.id);
            const status = atual?.status ?? "pendente";
            return (
              <div key={m.id} className="flex items-center justify-between rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{m.nome}</p>
                    {m.aplica_restricao && (
                      <Badge variant="outline" className="text-[10px]">restringe</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{fmtBRL(m.valor)} · {m.chave}</p>
                  {atual && (
                    <ModuloPrecoControls
                      empresaId={assinatura.empresa_id}
                      moduloId={m.id}
                      valor={precosMap.get(m.id)?.valor_contratado ?? m.valor}
                      personalizado={precosMap.get(m.id)?.valor_personalizado ?? false}
                    />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={status}
                    onValueChange={(v) => {
                      setMod.mutate({
                        empresa_id: assinatura.empresa_id,
                        modulo_id: m.id,
                        status: v as EmpresaModuloStatus,
                      });
                    }}
                  >
                    <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ativo">Ativo</SelectItem>
                      <SelectItem value="pendente">Pendente</SelectItem>
                      <SelectItem value="cancelado">Cancelado</SelectItem>
                    </SelectContent>
                  </Select>
                  {atual && (
                    <Button variant="ghost" size="sm" onClick={() => removeMod.mutate(atual.id)}>
                      Remover
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModuloPrecoControls({
  empresaId, moduloId, valor, personalizado,
}: { empresaId: string; moduloId: string; valor: number; personalizado: boolean }) {
  const setPreco = useAdminSetPrecoModulo();
  const [valorLocal, setValorLocal] = useState(String(valor));
  const [custom, setCustom] = useState(personalizado);

  useEffect(() => {
    setValorLocal(String(valor));
    setCustom(personalizado);
  }, [valor, personalizado]);

  const salvar = async (customValue = custom) => {
    const numero = Number(valorLocal.replace(",", "."));
    if (!Number.isFinite(numero) || numero < 0) return;
    await setPreco.mutateAsync({ empresa_id: empresaId, modulo_id: moduloId, valor: numero, personalizado: customValue });
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Input className="h-7 w-24" type="number" min="0" step="0.01" value={valorLocal}
        onChange={(e) => setValorLocal(e.target.value)} onBlur={() => void salvar()} />
      <div className="flex items-center gap-1.5">
        <Checkbox checked={custom} onCheckedChange={(checked) => {
          const next = checked === true;
          setCustom(next);
          void salvar(next);
        }} />
        <span className="text-xs text-muted-foreground">Valor personalizado</span>
      </div>
    </div>
  );
}
