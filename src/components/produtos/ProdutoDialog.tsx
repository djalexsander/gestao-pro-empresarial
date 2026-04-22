import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  useCategorias,
  useCreateProduto,
  useCreateVariacao,
  useDeleteVariacao,
  useProduto,
  useUpdateProduto,
  type ProdutoInput,
} from "@/hooks/useProdutos";

const produtoSchema = z.object({
  sku: z.string().trim().min(1, "SKU obrigatório").max(50),
  codigo_barras: z.string().trim().max(50).optional().or(z.literal("")),
  nome: z.string().trim().min(2, "Nome muito curto").max(200),
  descricao: z.string().trim().max(2000).optional().or(z.literal("")),
  marca: z.string().trim().max(100).optional().or(z.literal("")),
  unidade: z.string().trim().min(1).max(10),
  categoria_id: z.string().uuid().nullable().optional(),
  preco_custo: z.number().min(0),
  preco_venda: z.number().min(0),
  estoque_minimo: z.number().min(0),
  estoque_inicial: z.number().min(0),
  status: z.enum(["ativo", "inativo", "descontinuado"]),
  ncm: z.string().trim().max(10).optional().or(z.literal("")),
});

interface ProdutoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  produtoId?: string | null; // null/undefined => criação
}

export function ProdutoDialog({ open, onOpenChange, produtoId }: ProdutoDialogProps) {
  const isEdit = !!produtoId;
  const { data: categorias = [] } = useCategorias();
  const { data: produto } = useProduto(produtoId ?? undefined);
  const createMut = useCreateProduto();
  const updateMut = useUpdateProduto();

  const [form, setForm] = useState({
    sku: "",
    codigo_barras: "",
    nome: "",
    descricao: "",
    marca: "",
    unidade: "UN",
    categoria_id: "" as string,
    preco_custo: 0,
    preco_venda: 0,
    estoque_minimo: 0,
    estoque_inicial: 0,
    status: "ativo" as "ativo" | "inativo" | "descontinuado",
    ncm: "",
  });

  // Hidrata formulário ao abrir / mudar produto
  useEffect(() => {
    if (open && produto) {
      setForm({
        sku: produto.sku,
        codigo_barras: produto.codigo_barras ?? "",
        nome: produto.nome,
        descricao: produto.descricao ?? "",
        marca: produto.marca ?? "",
        unidade: produto.unidade,
        categoria_id: produto.categoria_id ?? "",
        preco_custo: Number(produto.preco_custo),
        preco_venda: Number(produto.preco_venda),
        estoque_minimo: Number(produto.estoque_minimo),
        estoque_inicial: 0,
        status: produto.status,
        ncm: produto.ncm ?? "",
      });
    }
    if (open && !produtoId) {
      setForm({
        sku: "", codigo_barras: "", nome: "", descricao: "", marca: "",
        unidade: "UN", categoria_id: "", preco_custo: 0, preco_venda: 0,
        estoque_minimo: 0, estoque_inicial: 0, status: "ativo", ncm: "",
      });
    }
  }, [open, produto, produtoId]);

  const margem = useMemo(() => {
    if (!form.preco_venda) return 0;
    if (!form.preco_custo) return 100;
    return ((form.preco_venda - form.preco_custo) / form.preco_venda) * 100;
  }, [form.preco_custo, form.preco_venda]);

  async function handleSubmit() {
    const parsed = produtoSchema.safeParse({
      ...form,
      categoria_id: form.categoria_id || null,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    const payload: ProdutoInput = {
      sku: parsed.data.sku,
      codigo_barras: parsed.data.codigo_barras || null,
      nome: parsed.data.nome,
      descricao: parsed.data.descricao || null,
      marca: parsed.data.marca || null,
      unidade: parsed.data.unidade,
      categoria_id: parsed.data.categoria_id ?? null,
      preco_custo: parsed.data.preco_custo,
      preco_venda: parsed.data.preco_venda,
      estoque_minimo: parsed.data.estoque_minimo,
      estoque_inicial: isEdit ? 0 : parsed.data.estoque_inicial,
      status: parsed.data.status,
      ncm: parsed.data.ncm || null,
    };
    try {
      if (isEdit && produtoId) {
        await updateMut.mutateAsync({ id: produtoId, ...payload });
      } else {
        await createMut.mutateAsync(payload);
      }
      onOpenChange(false);
    } catch {
      // toast já mostrado pelo hook
    }
  }

  const busy = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar produto" : "Novo produto"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Atualize as informações do produto." : "Cadastre um novo item no catálogo."}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="dados">
          <TabsList>
            <TabsTrigger value="dados">Dados gerais</TabsTrigger>
            <TabsTrigger value="precos">Preços e estoque</TabsTrigger>
            {isEdit && <TabsTrigger value="variacoes">Variações</TabsTrigger>}
          </TabsList>

          <TabsContent value="dados" className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sku">SKU *</Label>
                <Input id="sku" value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ean">Código de barras</Label>
                <Input id="ean" value={form.codigo_barras}
                  onChange={(e) => setForm({ ...form, codigo_barras: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nome">Nome *</Label>
              <Input id="nome" value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cat">Categoria</Label>
                <Select
                  value={form.categoria_id || "none"}
                  onValueChange={(v) => setForm({ ...form, categoria_id: v === "none" ? "" : v })}
                >
                  <SelectTrigger id="cat"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem categoria</SelectItem>
                    {categorias.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="marca">Marca</Label>
                <Input id="marca" value={form.marca}
                  onChange={(e) => setForm({ ...form, marca: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="un">Unidade</Label>
                <Input id="un" value={form.unidade} maxLength={10}
                  onChange={(e) => setForm({ ...form, unidade: e.target.value.toUpperCase() })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ncm">NCM</Label>
                <Input id="ncm" value={form.ncm}
                  onChange={(e) => setForm({ ...form, ncm: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="status">Status</Label>
                <Select value={form.status}
                  onValueChange={(v) => setForm({ ...form, status: v as typeof form.status })}>
                  <SelectTrigger id="status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ativo">Ativo</SelectItem>
                    <SelectItem value="inativo">Inativo</SelectItem>
                    <SelectItem value="descontinuado">Descontinuado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="desc">Descrição</Label>
              <Textarea id="desc" rows={3} value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
            </div>
          </TabsContent>

          <TabsContent value="precos" className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="custo">Preço de custo (R$)</Label>
                <Input id="custo" type="number" min={0} step="0.01"
                  value={form.preco_custo}
                  onChange={(e) => setForm({ ...form, preco_custo: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="venda">Preço de venda (R$)</Label>
                <Input id="venda" type="number" min={0} step="0.01"
                  value={form.preco_venda}
                  onChange={(e) => setForm({ ...form, preco_venda: Number(e.target.value) })} />
              </div>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
              <p className="text-sm text-muted-foreground">Margem calculada</p>
              <p className={`text-2xl font-semibold ${margem >= 0 ? "text-success" : "text-destructive"}`}>
                {margem.toFixed(1)}%
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="min">Estoque mínimo</Label>
                <Input id="min" type="number" min={0} step="0.001"
                  value={form.estoque_minimo}
                  onChange={(e) => setForm({ ...form, estoque_minimo: Number(e.target.value) })} />
              </div>
              {!isEdit && (
                <div className="space-y-1.5">
                  <Label htmlFor="inicial">Estoque inicial</Label>
                  <Input id="inicial" type="number" min={0} step="0.001"
                    value={form.estoque_inicial}
                    onChange={(e) => setForm({ ...form, estoque_inicial: Number(e.target.value) })} />
                  <p className="text-xs text-muted-foreground">
                    Cria movimentação de entrada automaticamente.
                  </p>
                </div>
              )}
            </div>
          </TabsContent>

          {isEdit && produtoId && (
            <TabsContent value="variacoes" className="mt-4">
              <VariacoesEditor produtoId={produtoId} />
            </TabsContent>
          )}
        </Tabs>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={busy}>
            {busy ? "Salvando..." : isEdit ? "Salvar alterações" : "Cadastrar produto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VariacoesEditor({ produtoId }: { produtoId: string }) {
  const { data: produto } = useProduto(produtoId);
  const createMut = useCreateVariacao();
  const deleteMut = useDeleteVariacao();
  const [adding, setAdding] = useState(false);
  const [nova, setNova] = useState({
    sku: "",
    nome: "",
    cor: "",
    tamanho: "",
    preco_venda: "",
    preco_custo: "",
  });

  async function handleAdd() {
    if (!nova.sku.trim() || !nova.nome.trim()) {
      toast.error("Informe SKU e nome da variação.");
      return;
    }
    const atributos: Record<string, string> = {};
    if (nova.cor) atributos.cor = nova.cor;
    if (nova.tamanho) atributos.tamanho = nova.tamanho;
    try {
      await createMut.mutateAsync({
        produto_id: produtoId,
        sku: nova.sku.trim(),
        nome: nova.nome.trim(),
        atributos,
        preco_custo: nova.preco_custo ? Number(nova.preco_custo) : null,
        preco_venda: nova.preco_venda ? Number(nova.preco_venda) : null,
      });
      setNova({ sku: "", nome: "", cor: "", tamanho: "", preco_venda: "", preco_custo: "" });
      setAdding(false);
    } catch {/* toast pelo hook */}
  }

  return (
    <div className="space-y-3">
      {(produto?.variacoes ?? []).length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">Nenhuma variação cadastrada.</p>
      )}

      {(produto?.variacoes ?? []).map((v) => (
        <div key={v.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{v.nome}</p>
            <p className="text-xs text-muted-foreground font-mono">{v.sku}</p>
            {Object.keys(v.atributos ?? {}).length > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {Object.entries(v.atributos).map(([k, val]) => `${k}: ${val}`).join(" • ")}
              </p>
            )}
          </div>
          <Button variant="ghost" size="icon" className="text-destructive"
            onClick={() => deleteMut.mutate({ id: v.id, produto_id: produtoId })}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}

      {adding ? (
        <div className="space-y-3 rounded-lg border border-dashed border-border p-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>SKU da variação *</Label>
              <Input value={nova.sku} onChange={(e) => setNova({ ...nova, sku: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Nome *</Label>
              <Input value={nova.nome}
                onChange={(e) => setNova({ ...nova, nome: e.target.value })}
                placeholder="Ex: Camiseta P Preta" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tamanho</Label>
              <Input value={nova.tamanho} onChange={(e) => setNova({ ...nova, tamanho: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Cor</Label>
              <Input value={nova.cor} onChange={(e) => setNova({ ...nova, cor: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Custo (opcional)</Label>
              <Input type="number" min={0} step="0.01" value={nova.preco_custo}
                onChange={(e) => setNova({ ...nova, preco_custo: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Venda (opcional)</Label>
              <Input type="number" min={0} step="0.01" value={nova.preco_venda}
                onChange={(e) => setNova({ ...nova, preco_venda: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleAdd} disabled={createMut.isPending}>Adicionar</Button>
            <Button size="sm" variant="outline" onClick={() => setAdding(false)}>Cancelar</Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setAdding(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Nova variação
        </Button>
      )}
    </div>
  );
}
