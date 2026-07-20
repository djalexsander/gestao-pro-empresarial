import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Loader2, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  useAdminAplicarReajuste,
  useAdminReajusteEmpresas,
  useAdminReajusteHistorico,
  useAdminReajustesCatalogo,
  type ReajusteCatalogoRow,
} from "@/hooks/useSaasAdmin";

export const Route = createFileRoute("/admin/reajustes")({
  head: () => ({ meta: [{ title: "Reajustes — Master" }] }),
  component: ReajustesPage,
});

const fmtBRL = (value: number | null) => Number(value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("pt-BR");

function ReajustesPage() {
  const { data = [], isLoading } = useAdminReajustesCatalogo();
  const { data: historico = [] } = useAdminReajusteHistorico();
  const [item, setItem] = useState<ReajusteCatalogoRow | null>(null);
  const planos = data.filter((row) => row.tipo === "plano");
  const modulos = data.filter((row) => row.tipo === "modulo");

  return (
    <div className="space-y-6">
      <PageHeader title="Reajuste de Assinaturas" description="Atualize o catálogo para novas contratações e controle separadamente os preços já contratados." />
      <CatalogoCard title="Planos" rows={planos} loading={isLoading} onApply={setItem} />
      <CatalogoCard title="Módulos" rows={modulos} loading={isLoading} onApply={setItem} />
      <Card>
        <CardHeader><CardTitle>Histórico de reajustes</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Empresa</TableHead><TableHead>Item</TableHead><TableHead>Alteração</TableHead><TableHead>Vigência</TableHead><TableHead>Aplicação</TableHead><TableHead>Motivo</TableHead></TableRow></TableHeader>
            <TableBody>
              {historico.length === 0 ? <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Nenhum reajuste registrado.</TableCell></TableRow> : historico.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.empresa_nome}</TableCell>
                  <TableCell><Badge variant="outline" className="mr-2 capitalize">{row.tipo}</Badge>{row.item_nome}</TableCell>
                  <TableCell>{fmtBRL(row.valor_anterior)} → <strong>{fmtBRL(row.valor_novo)}</strong></TableCell>
                  <TableCell>{fmtDate(row.vigencia)}</TableCell>
                  <TableCell>{row.aplicado_em ? <Badge>Aplicado</Badge> : <Badge variant="secondary">Programado</Badge>}</TableCell>
                  <TableCell className="max-w-48 truncate text-muted-foreground">{row.motivo ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {item && <ReajusteDialog item={item} onClose={() => setItem(null)} />}
    </div>
  );
}

function CatalogoCard({ title, rows, loading, onApply }: { title: string; rows: ReajusteCatalogoRow[]; loading: boolean; onApply: (row: ReajusteCatalogoRow) => void }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Preço atual do catálogo</TableHead><TableHead>Preço futuro</TableHead><TableHead>Empresas utilizando</TableHead><TableHead>Valor médio contratado</TableHead><TableHead className="text-right">Ação</TableHead></TableRow></TableHeader>
          <TableBody>
            {loading ? <TableRow><TableCell colSpan={6} className="py-8 text-center">Carregando...</TableCell></TableRow> : rows.map((row) => (
              <TableRow key={`${row.tipo}-${row.item_id}`}>
                <TableCell className="font-medium">{row.nome}</TableCell>
                <TableCell>{fmtBRL(row.preco_catalogo)}</TableCell>
                <TableCell>{row.preco_futuro == null ? "—" : fmtBRL(row.preco_futuro)}</TableCell>
                <TableCell>{row.empresas_ativas}</TableCell>
                <TableCell>{row.valor_medio_contratado == null ? "—" : fmtBRL(row.valor_medio_contratado)}</TableCell>
                <TableCell className="text-right"><Button size="sm" onClick={() => onApply(row)}><TrendingUp className="mr-2 h-4 w-4" />Aplicar reajuste</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

type Escopo = "novos" | "todos_ativos" | "empresas" | "plano_base" | "premium";
function ReajusteDialog({ item, onClose }: { item: ReajusteCatalogoRow; onClose: () => void }) {
  const aplicar = useAdminAplicarReajuste();
  const { data: empresas = [], isLoading } = useAdminReajusteEmpresas(item.tipo, item.item_id);
  const [novoValor, setNovoValor] = useState(String(item.preco_catalogo));
  const [escopo, setEscopo] = useState<Escopo>("novos");
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  const [vigencia, setVigencia] = useState(new Date().toISOString().slice(0, 10));
  const [modo, setModo] = useState<"imediato" | "proxima_renovacao">("proxima_renovacao");
  const [motivo, setMotivo] = useState("");

  useEffect(() => setSelecionadas([]), [escopo]);
  const elegiveis = useMemo(() => empresas.filter((empresa) => {
    if (empresa.valor_personalizado) return false;
    if (escopo === "novos") return false;
    if (escopo === "empresas") return selecionadas.includes(empresa.empresa_id);
    if (escopo === "plano_base") return empresa.plano_nome?.toLowerCase().includes("base");
    if (escopo === "premium") return empresa.plano_nome?.toLowerCase().includes("premium");
    return true;
  }), [empresas, escopo, selecionadas]);
  const parsedValue = Number(novoValor.replace(",", "."));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Aplicar reajuste — {item.nome}</DialogTitle><DialogDescription>O preço do catálogo será usado por novas compras. Contratos personalizados serão sempre ignorados.</DialogDescription></DialogHeader>
        <div className="space-y-5 py-2">
          <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label>Preço atual</Label><Input value={fmtBRL(item.preco_catalogo)} disabled /></div><div className="space-y-1.5"><Label>Novo preço</Label><Input inputMode="decimal" value={novoValor} onChange={(event) => setNovoValor(event.target.value)} /></div></div>
          <div className="space-y-2"><Label>Escopo</Label><RadioGroup value={escopo} onValueChange={(value) => setEscopo(value as Escopo)} className="grid gap-2 sm:grid-cols-2">
            {[['novos','Apenas novos clientes'],['todos_ativos','Todos os clientes ativos'],['empresas','Empresas selecionadas'],['plano_base','Somente clientes do Plano Base'],['premium','Somente clientes Premium']].map(([value,label]) => <label key={value} className="flex items-center gap-2 rounded-md border p-3 text-sm"><RadioGroupItem value={value} />{label}</label>)}
          </RadioGroup></div>
          {escopo === "empresas" && <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">{isLoading ? "Carregando..." : empresas.map((empresa) => <label key={empresa.empresa_id} className="flex items-center justify-between gap-3 rounded p-2 text-sm hover:bg-muted"><span className="flex items-center gap-2"><Checkbox disabled={empresa.valor_personalizado} checked={selecionadas.includes(empresa.empresa_id)} onCheckedChange={(checked) => setSelecionadas((current) => checked ? [...current, empresa.empresa_id] : current.filter((id) => id !== empresa.empresa_id))} />{empresa.empresa_nome}</span><span className="text-xs text-muted-foreground">{fmtBRL(empresa.valor_contratado)}{empresa.valor_personalizado ? " · personalizado" : ""}</span></label>)}</div>}
          <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label>Data de vigência</Label><Input type="date" value={vigencia} onChange={(event) => setVigencia(event.target.value)} /></div><div className="space-y-2"><Label>Quando aplicar aos contratos</Label><RadioGroup value={modo} onValueChange={(value) => setModo(value as typeof modo)}><label className="flex items-center gap-2 text-sm"><RadioGroupItem value="imediato" />Aplicar imediatamente na vigência</label><label className="flex items-center gap-2 text-sm"><RadioGroupItem value="proxima_renovacao" />Na próxima renovação</label></RadioGroup></div></div>
          <div className="space-y-1.5"><Label>Motivo (opcional)</Label><Textarea value={motivo} onChange={(event) => setMotivo(event.target.value)} rows={2} /></div>
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4"><div className="flex items-center gap-2 font-semibold"><CalendarClock className="h-4 w-4" />Preview</div><div className="mt-3 grid grid-cols-3 gap-3 text-sm"><div><span className="block text-xs text-muted-foreground">Preço antigo</span>{fmtBRL(item.preco_catalogo)}</div><div><span className="block text-xs text-muted-foreground">Novo</span><strong>{Number.isFinite(parsedValue) ? fmtBRL(parsedValue) : "Inválido"}</strong></div><div><span className="block text-xs text-muted-foreground">Empresas afetadas</span><strong>{elegiveis.length}</strong></div></div></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={aplicar.isPending || !Number.isFinite(parsedValue) || parsedValue < 0 || !vigencia || (escopo === "empresas" && selecionadas.length === 0)} onClick={async () => { await aplicar.mutateAsync({ tipo:item.tipo,item_id:item.item_id,novo_valor:parsedValue,escopo,empresas:selecionadas,vigencia,modo,motivo:motivo.trim()||null }); onClose(); }}>{aplicar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar reajuste</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
