import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, AlertTriangle, QrCode, Sparkles, Printer } from "lucide-react";
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
import { FormSection } from "@/components/shared/FormSection";
import {
  useCreateProduto,
  useCreateVariacao,
  useDeleteVariacao,
  useProduto,
  useUpdateProduto,
  type ProdutoInput,
  type TipoIdentificacao,
} from "@/hooks/useProdutos";
import { CodeInput, QrPreview, BarcodePreview } from "@/components/scanner";
import { gerarEan13, validarEan13 } from "@/lib/barcode";
import { EtiquetaImpressaoDialog } from "@/components/produtos/EtiquetaImpressaoDialog";
import { CategoriaCombobox } from "@/components/produtos/CategoriaCombobox";
import {
  useAddProdutoCodigo,
  useDeleteProdutoCodigo,
  useProdutoCodigos,
  type CodigoTipo,
} from "@/hooks/useProdutoCodigo";

const produtoSchema = z.object({
  sku: z.string().trim().min(1, "SKU obrigatório").max(50),
  codigo_barras: z.string().trim().max(80).optional().or(z.literal("")),
  qr_code: z.string().trim().max(500).optional().or(z.literal("")),
  codigo_interno: z.string().trim().max(50).optional().or(z.literal("")),
  tipo_identificacao_principal: z.enum(["sku", "codigo_barras", "qr_code", "codigo_interno"]),
  observacao_tecnica: z.string().trim().max(1000).optional().or(z.literal("")),
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
  vendido_por_peso: z.boolean(),
  plu: z.string().trim().max(20).optional().or(z.literal("")),
  aceita_etiqueta_balanca: z.boolean(),
  casas_decimais_quantidade: z.number().int().min(0).max(4),
});

interface ProdutoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  produtoId?: string | null;
  /** Pré-preenche um código ao abrir em modo criação */
  prefilledCodigo?: { valor: string; tipo: TipoIdentificacao };
}

const EMPTY = {
  sku: "", codigo_barras: "", qr_code: "", codigo_interno: "",
  tipo_identificacao_principal: "sku" as TipoIdentificacao,
  observacao_tecnica: "",
  nome: "", descricao: "", marca: "",
  unidade: "UN", categoria_id: "" as string,
  preco_custo: 0, preco_venda: 0,
  estoque_minimo: 0, estoque_inicial: 0,
  status: "ativo" as "ativo" | "inativo" | "descontinuado",
  ncm: "",
  vendido_por_peso: false,
  plu: "",
  aceita_etiqueta_balanca: false,
  casas_decimais_quantidade: 3,
};

export function ProdutoDialog({ open, onOpenChange, produtoId, prefilledCodigo }: ProdutoDialogProps) {
  const isEdit = !!produtoId;
  const { data: produto } = useProduto(produtoId ?? undefined);
  const createMut = useCreateProduto();
  const updateMut = useUpdateProduto();

  const [form, setForm] = useState(EMPTY);
  const [etiquetaOpen, setEtiquetaOpen] = useState(false);

  useEffect(() => {
    if (open && produto) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = produto as any;
      setForm({
        sku: produto.sku,
        codigo_barras: produto.codigo_barras ?? "",
        qr_code: produto.qr_code ?? "",
        codigo_interno: produto.codigo_interno ?? "",
        tipo_identificacao_principal: produto.tipo_identificacao_principal ?? "sku",
        observacao_tecnica: produto.observacao_tecnica ?? "",
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
        vendido_por_peso: Boolean(p.vendido_por_peso),
        plu: p.plu ?? "",
        aceita_etiqueta_balanca: Boolean(p.aceita_etiqueta_balanca),
        casas_decimais_quantidade: Number(p.casas_decimais_quantidade ?? 3),
      });
    }
    if (open && !produtoId) {
      const base = { ...EMPTY };
      if (prefilledCodigo) {
        base.tipo_identificacao_principal = prefilledCodigo.tipo;
        if (prefilledCodigo.tipo === "codigo_barras") base.codigo_barras = prefilledCodigo.valor;
        else if (prefilledCodigo.tipo === "qr_code") base.qr_code = prefilledCodigo.valor;
        else if (prefilledCodigo.tipo === "codigo_interno") base.codigo_interno = prefilledCodigo.valor;
        else base.sku = prefilledCodigo.valor;
      }
      setForm(base);
    }
  }, [open, produto, produtoId, prefilledCodigo]);

  const margem = useMemo(() => {
    if (!form.preco_venda) return 0;
    if (!form.preco_custo) return 100;
    return ((form.preco_venda - form.preco_custo) / form.preco_venda) * 100;
  }, [form.preco_custo, form.preco_venda]);

  const semCodigo =
    !form.codigo_barras.trim() && !form.qr_code.trim() && !form.codigo_interno.trim();

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
      qr_code: parsed.data.qr_code || null,
      codigo_interno: parsed.data.codigo_interno || null,
      tipo_identificacao_principal: parsed.data.tipo_identificacao_principal,
      observacao_tecnica: parsed.data.observacao_tecnica || null,
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
      vendido_por_peso: parsed.data.vendido_por_peso,
      plu: parsed.data.plu || null,
      aceita_etiqueta_balanca: parsed.data.aceita_etiqueta_balanca,
      casas_decimais_quantidade: parsed.data.casas_decimais_quantidade,
    };
    try {
      if (isEdit && produtoId) {
        await updateMut.mutateAsync({ id: produtoId, ...payload });
      } else {
        await createMut.mutateAsync(payload);
      }
      onOpenChange(false);
    } catch {/* toast já mostrado pelo hook */}
  }

  const busy = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar produto" : "Novo produto"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Atualize as informações do produto." : "Cadastre um novo item no catálogo."}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="dados">
          <TabsList>
            <TabsTrigger value="dados">Dados gerais</TabsTrigger>
            <TabsTrigger value="codigos">Códigos</TabsTrigger>
            <TabsTrigger value="precos">Preços e estoque</TabsTrigger>
            {isEdit && <TabsTrigger value="variacoes">Variações</TabsTrigger>}
          </TabsList>

          {/* ============== DADOS ============== */}
          <TabsContent value="dados" className="mt-4 space-y-6">
            <FormSection
              title="Identificação operacional"
              subtitle="Como o produto aparece na venda, PDV e estoque."
              tone="operacional"
              divider={false}
            >
              <div className="space-y-1.5">
                <Label htmlFor="nome">Nome *</Label>
                <Input id="nome" value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cat">Categoria</Label>
                  <CategoriaCombobox
                    id="cat"
                    value={form.categoria_id}
                    onChange={(catId) => setForm({ ...form, categoria_id: catId })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="marca">Marca</Label>
                  <Input id="marca" value={form.marca}
                    onChange={(e) => setForm({ ...form, marca: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="un">Unidade</Label>
                  <Input id="un" value={form.unidade} maxLength={10}
                    onChange={(e) => setForm({ ...form, unidade: e.target.value.toUpperCase() })} />
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
            </FormSection>

            <FormSection
              title="Dados fiscais"
              subtitle="Classificação tributária usada em notas e relatórios fiscais."
              tone="fiscal"
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ncm">NCM</Label>
                  <Input id="ncm" value={form.ncm} placeholder="0000.00.00"
                    onChange={(e) => setForm({ ...form, ncm: e.target.value })} />
                </div>
              </div>
            </FormSection>
          </TabsContent>

          {/* ============== CÓDIGOS ============== */}
          <TabsContent value="codigos" className="mt-4 space-y-4">
            {semCodigo && (
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <p>
                  Nenhum código de identificação informado. Recomendamos cadastrar pelo menos um
                  (código de barras, QR Code ou código interno) para agilizar buscas e vendas.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sku">SKU *</Label>
                <Input id="sku" value={form.sku} className="font-mono"
                  onChange={(e) => setForm({ ...form, sku: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cint">Código interno</Label>
                <Input id="cint" value={form.codigo_interno} className="font-mono"
                  onChange={(e) => setForm({ ...form, codigo_interno: e.target.value })} />
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-border p-4">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="ean">Código de barras</Label>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => {
                      let novo = gerarEan13("200");
                      // tentativa simples de evitar repetir o já existente
                      if (form.codigo_barras.trim() === novo) novo = gerarEan13("200");
                      setForm({ ...form, codigo_barras: novo });
                      toast.success("Código EAN-13 gerado.");
                    }}
                  >
                    <Sparkles className="h-3.5 w-3.5" /> Gerar EAN-13
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    disabled={!form.codigo_barras.trim()}
                    onClick={() => setEtiquetaOpen(true)}
                  >
                    <Printer className="h-3.5 w-3.5" /> Imprimir etiqueta
                  </Button>
                </div>
              </div>

              <CodeInput
                id="ean"
                value={form.codigo_barras}
                onChange={(v) => setForm({ ...form, codigo_barras: v })}
                scannerMode="barcode"
                buttonIcon="barcode"
                placeholder="EAN-13, Code-128, etc."
              />

              {form.codigo_barras.trim() ? (
                <div className="flex flex-col items-center gap-1 pt-1">
                  <BarcodePreview
                    value={form.codigo_barras.trim()}
                    filename={`barcode-${form.sku || "produto"}.png`}
                  />
                  {validarEan13(form.codigo_barras.trim()) && (
                    <p className="text-xs text-success">EAN-13 válido ✓</p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Digite um código manual, escaneie com a câmera ou clique em
                  <span className="font-medium"> Gerar EAN-13</span> para criar um código interno.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="qr">QR Code</Label>
              <CodeInput
                id="qr"
                value={form.qr_code}
                onChange={(v) => setForm({ ...form, qr_code: v })}
                scannerMode="qrcode"
                buttonIcon="qrcode"
                placeholder="Conteúdo do QR Code"
              />
            </div>

            <div className="grid grid-cols-2 gap-4 rounded-lg border border-border p-4">
              <div className="space-y-2">
                <Label>Tipo principal de identificação</Label>
                <Select
                  value={form.tipo_identificacao_principal}
                  onValueChange={(v) => setForm({ ...form, tipo_identificacao_principal: v as TipoIdentificacao })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sku">SKU</SelectItem>
                    <SelectItem value="codigo_barras">Código de barras</SelectItem>
                    <SelectItem value="qr_code">QR Code</SelectItem>
                    <SelectItem value="codigo_interno">Código interno</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Define qual código aparece em destaque nas telas de venda e estoque.
                </p>
              </div>

              <div className="flex items-center justify-center">
                {form.qr_code.trim() ? (
                  <QrPreview value={form.qr_code} size={140} filename={`qr-${form.sku || "produto"}.png`} />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-center text-xs text-muted-foreground">
                    <QrCode className="h-8 w-8 opacity-40" />
                    Preencha o campo QR Code para visualizar
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="obs-tec">Observação técnica</Label>
              <Textarea id="obs-tec" rows={2} value={form.observacao_tecnica}
                placeholder="Notas internas sobre identificação, embalagem, leitura, etc."
                onChange={(e) => setForm({ ...form, observacao_tecnica: e.target.value })} />
            </div>

            {isEdit && produtoId && <CodigosAdicionais produtoId={produtoId} />}
          </TabsContent>

          {/* ============== PREÇOS ============== */}
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

            <div className="rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Vendido por peso (balança)</p>
                  <p className="text-xs text-muted-foreground">
                    Permite quantidade fracionada e leitura de etiqueta da balança.
                  </p>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={form.vendido_por_peso}
                  onChange={(e) => setForm({ ...form, vendido_por_peso: e.target.checked })}
                />
              </div>
              {form.vendido_por_peso && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="plu">PLU / Código base</Label>
                    <Input id="plu" className="font-mono" value={form.plu}
                      onChange={(e) => setForm({ ...form, plu: e.target.value.replace(/\D/g, "") })}
                      placeholder="Ex.: 12345" />
                    <p className="text-xs text-muted-foreground">
                      Código numérico cadastrado na balança que identifica este produto.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cdq">Casas decimais da quantidade</Label>
                    <Input id="cdq" type="number" min={0} max={4}
                      value={form.casas_decimais_quantidade}
                      onChange={(e) => setForm({ ...form, casas_decimais_quantidade: Number(e.target.value) })} />
                  </div>
                  <div className="col-span-2 flex items-center justify-between rounded-md border border-border p-3">
                    <div>
                      <p className="text-sm font-medium">Aceita etiqueta da balança</p>
                      <p className="text-xs text-muted-foreground">
                        Quando ativo, o PDV interpreta etiquetas com este PLU.
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={form.aceita_etiqueta_balanca}
                      onChange={(e) => setForm({ ...form, aceita_etiqueta_balanca: e.target.checked })}
                    />
                  </div>
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

        <EtiquetaImpressaoDialog
          open={etiquetaOpen}
          onOpenChange={setEtiquetaOpen}
          produto={{
            nome: form.nome || "Produto",
            codigo: form.codigo_barras.trim(),
            preco: form.preco_venda || null,
            sku: form.sku || null,
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

// ================ Códigos adicionais (tabela auxiliar) ================
function CodigosAdicionais({ produtoId }: { produtoId: string }) {
  const { data: codigos = [] } = useProdutoCodigos(produtoId);
  const addMut = useAddProdutoCodigo();
  const delMut = useDeleteProdutoCodigo();
  const [novo, setNovo] = useState({ tipo: "alternativo" as CodigoTipo, valor: "" });

  return (
    <div className="space-y-2 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Códigos adicionais</p>
          <p className="text-xs text-muted-foreground">Embalagens, lotes, códigos antigos, etc.</p>
        </div>
      </div>

      {codigos.length > 0 && (
        <ul className="space-y-1.5">
          {codigos.map((c) => (
            <li key={c.id} className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5">
              <span className="rounded bg-background px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {c.tipo_codigo}
              </span>
              <span className="flex-1 truncate font-mono text-sm">{c.valor_codigo}</span>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                onClick={() => delMut.mutate({ id: c.id, produto_id: produtoId })}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Select value={novo.tipo} onValueChange={(v) => setNovo({ ...novo, tipo: v as CodigoTipo })}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="codigo_barras">Código de barras</SelectItem>
            <SelectItem value="qr_code">QR Code</SelectItem>
            <SelectItem value="sku">SKU</SelectItem>
            <SelectItem value="interno">Interno</SelectItem>
            <SelectItem value="alternativo">Alternativo</SelectItem>
          </SelectContent>
        </Select>
        <CodeInput
          value={novo.valor}
          onChange={(v) => setNovo({ ...novo, valor: v })}
          scannerMode={novo.tipo === "qr_code" ? "qrcode" : "any"}
          buttonIcon={novo.tipo === "qr_code" ? "qrcode" : "barcode"}
          containerClassName="flex-1"
          placeholder="Escaneie ou digite o código"
        />
        <Button size="sm" disabled={!novo.valor.trim() || addMut.isPending}
          onClick={async () => {
            try {
              await addMut.mutateAsync({
                produto_id: produtoId,
                tipo_codigo: novo.tipo,
                valor_codigo: novo.valor.trim(),
              });
              setNovo({ tipo: "alternativo", valor: "" });
            } catch {/* toast pelo hook */}
          }}>
          Adicionar
        </Button>
      </div>
    </div>
  );
}

// ================ Variações (mantido) ================
function VariacoesEditor({ produtoId }: { produtoId: string }) {
  const { data: produto } = useProduto(produtoId);
  const createMut = useCreateVariacao();
  const deleteMut = useDeleteVariacao();
  const [adding, setAdding] = useState(false);
  const [nova, setNova] = useState({
    sku: "", nome: "", cor: "", tamanho: "", preco_venda: "", preco_custo: "",
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
            <div className="space-y-1.5"><Label>Tamanho</Label>
              <Input value={nova.tamanho} onChange={(e) => setNova({ ...nova, tamanho: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Cor</Label>
              <Input value={nova.cor} onChange={(e) => setNova({ ...nova, cor: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Custo (opcional)</Label>
              <Input type="number" min={0} step="0.01" value={nova.preco_custo}
                onChange={(e) => setNova({ ...nova, preco_custo: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Venda (opcional)</Label>
              <Input type="number" min={0} step="0.01" value={nova.preco_venda}
                onChange={(e) => setNova({ ...nova, preco_venda: e.target.value })} /></div>
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
