import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ScanLine,
  Search,
  Camera,
  Package,
  PackagePlus,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  ArrowLeft,
  Boxes,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { ScannerDialog } from "./ScannerDialog";
import { useScanner } from "@/hooks/useScanner";
import {
  buscarProdutoPorCodigo,
  type ProdutoBuscaResult,
} from "@/hooks/useProdutoCodigo";
import {
  buscarProdutoExterno,
  type ProdutoExterno,
} from "@/lib/buscaExternaProduto";
import { useCriarMovimentacao, useEstoqueSaldos } from "@/hooks/useEstoque";
import { useCategorias, useCreateProduto, useProdutos } from "@/hooks/useProdutos";
import { useFornecedores } from "@/hooks/useFornecedores";
import { cn } from "@/lib/utils";

type Step = "scan" | "entry-existing" | "entry-new";

interface EntradaPorCodigoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Fluxo profissional de entrada de estoque por código:
 *  1. Scan (manual / USB / câmera)
 *  2. Busca interna por código (RPC com RLS)
 *  3a. Encontrado → quick-entry (qtd, custo, fornecedor, observação)
 *  3b. Não encontrado → tenta busca externa → sugere pré-cadastro ou abre cadastro manual
 *  4. Salva: cria produto se necessário e registra movimentação de entrada
 */
export function EntradaPorCodigoDialog({
  open,
  onOpenChange,
}: EntradaPorCodigoDialogProps) {
  const [step, setStep] = useState<Step>("scan");
  const [code, setCode] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState<ProdutoBuscaResult | null>(null);
  const [external, setExternal] = useState<ProdutoExterno | null>(null);
  const [externalChecked, setExternalChecked] = useState(false);

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep("scan");
      setCode("");
      setFound(null);
      setExternal(null);
      setExternalChecked(false);
    }
  }, [open]);

  async function processCode(value: string) {
    const v = value.trim();
    if (!v) return;
    setCode(v);
    setSearching(true);
    setExternal(null);
    setExternalChecked(false);
    setFound(null);

    try {
      // 1. Busca interna primeiro
      const internal = await buscarProdutoPorCodigo(v);
      if (internal) {
        setFound(internal);
        setStep("entry-existing");
        return;
      }

      // 2. Não encontrado: tenta API externa em paralelo, mas já avança para o passo
      setStep("entry-new");
      try {
        const ext = await buscarProdutoExterno(v);
        setExternal(ext);
      } catch {
        /* ignora — apenas complementar */
      } finally {
        setExternalChecked(true);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSearching(false);
    }
  }

  // Scanner USB ativo enquanto está no passo "scan"
  useScanner((scanned) => processCode(scanned), {
    enabled: open && step === "scan",
  });

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    processCode(code);
  }

  function backToScan() {
    setStep("scan");
    setFound(null);
    setExternal(null);
    setExternalChecked(false);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent keyboardNav={false} className="max-w-xl gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border bg-muted/30 px-5 py-4">
            <DialogTitle className="flex items-center gap-2">
              {step === "scan" && <ScanLine className="h-4 w-4 text-primary" />}
              {step === "entry-existing" && <Package className="h-4 w-4 text-success" />}
              {step === "entry-new" && <PackagePlus className="h-4 w-4 text-primary" />}
              {step === "scan" && "Entrada por leitura de código"}
              {step === "entry-existing" && "Registrar entrada de estoque"}
              {step === "entry-new" && "Cadastrar produto e dar entrada"}
            </DialogTitle>
            <DialogDescription>
              {step === "scan" && "Escaneie um código de barras ou QR Code, ou digite manualmente."}
              {step === "entry-existing" && "Produto encontrado no sistema. Informe os dados da entrada."}
              {step === "entry-new" &&
                (external
                  ? "Produto não cadastrado. Sugestão encontrada em base externa — revise e confirme."
                  : externalChecked
                    ? "Produto não cadastrado e sem dados externos. Preencha os campos abaixo."
                    : "Buscando dados externos do produto…")}
            </DialogDescription>
          </DialogHeader>

          {/* Conteúdo por step */}
          {step === "scan" && (
            <div className="space-y-4 px-5 py-5">
              <form onSubmit={handleManualSubmit} className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    autoFocus
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Escaneie ou digite o código..."
                    className="pl-9 font-mono"
                  />
                  {searching && (
                    <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setScannerOpen(true)}
                  title="Abrir câmera"
                >
                  <Camera className="h-4 w-4" />
                </Button>
                <Button type="submit" disabled={!code.trim() || searching}>
                  Buscar
                </Button>
              </form>

              <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-center">
                <ScanLine className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">Pronto para ler</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Use um leitor USB (funciona como teclado), abra a câmera ou digite o código
                  acima e pressione Enter.
                </p>
              </div>
            </div>
          )}

          {step === "entry-existing" && found && (
            <EntryExistingForm
              produto={found}
              codigo={code}
              onBack={backToScan}
              onSuccess={() => onOpenChange(false)}
            />
          )}

          {step === "entry-new" && (
            <EntryNewForm
              codigo={code}
              external={external}
              externalChecked={externalChecked}
              onBack={backToScan}
              onSuccess={() => onOpenChange(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <ScannerDialog
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        mode="any"
        onResult={(scanned) => processCode(scanned)}
      />
    </>
  );
}

/* ============================================================================
 * Form: produto JÁ EXISTE → registrar entrada
 * ============================================================================ */

function EntryExistingForm({
  produto,
  codigo,
  onBack,
  onSuccess,
}: {
  produto: ProdutoBuscaResult;
  codigo: string;
  onBack: () => void;
  onSuccess: () => void;
}) {
  const { data: fornecedores = [] } = useFornecedores();
  const { data: saldos } = useEstoqueSaldos();
  const criar = useCriarMovimentacao();

  const saldoAtual = useMemo(
    () => Number(saldos?.get(produto.produto_id) ?? produto.saldo_estoque ?? 0),
    [saldos, produto],
  );

  const [quantidade, setQuantidade] = useState("1");
  const [custo, setCusto] = useState(
    produto.preco_custo ? String(produto.preco_custo) : "",
  );
  const [fornecedorId, setFornecedorId] = useState<string>("none");
  const [observacoes, setObservacoes] = useState("");
  const qtyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // foca quantidade (já com 1 selecionado para o operador trocar rápido)
    setTimeout(() => {
      qtyRef.current?.focus();
      qtyRef.current?.select();
    }, 50);
  }, []);

  const qtdNum = Number(quantidade) || 0;
  const previsto = saldoAtual + qtdNum;

  async function salvar() {
    if (qtdNum <= 0) return toast.error("Informe a quantidade que entrou.");
    const fornecedorTexto =
      fornecedorId !== "none"
        ? fornecedores.find((f) => f.id === fornecedorId)?.razao_social
        : null;
    const obsFinal = [
      `Entrada via leitura (${codigo})`,
      fornecedorTexto ? `Fornecedor: ${fornecedorTexto}` : null,
      observacoes ? observacoes : null,
    ]
      .filter(Boolean)
      .join(" · ");

    try {
      await criar.mutateAsync({
        produto_id: produto.produto_id,
        tipo: "entrada",
        quantidade: qtdNum,
        custo_unitario: custo ? Number(custo) : null,
        observacoes: obsFinal,
        saldo_atual: saldoAtual,
        origem: "ajuste_manual",
      });
      onSuccess();
    } catch {
      /* toast tratado */
    }
  }

  return (
    <div className="space-y-4 px-5 py-5">
      {/* Card produto */}
      <Card className="border-success/40 bg-success/5 p-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-success/15 text-success">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium leading-tight">{produto.nome}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              <span className="font-mono">{produto.sku}</span>
              {produto.categoria_nome && ` · ${produto.categoria_nome}`}
              {` · ${produto.unidade}`}
            </p>
            <p className="mt-1.5 flex items-center gap-1.5 text-xs">
              <Boxes className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Estoque atual:</span>
              <span className="tabular-nums font-medium">{saldoAtual}</span>
            </p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Quantidade que entrou *</Label>
          <Input
            ref={qtyRef}
            type="number"
            step="0.001"
            min={0}
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Custo unitário</Label>
          <Input
            type="number"
            step="0.01"
            min={0}
            value={custo}
            onChange={(e) => setCusto(e.target.value)}
            placeholder="R$ 0,00"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Fornecedor (opcional)</Label>
        <Select value={fornecedorId} onValueChange={setFornecedorId}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione um fornecedor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— Sem fornecedor —</SelectItem>
            {fornecedores.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.razao_social}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Observação</Label>
        <Textarea
          rows={2}
          value={observacoes}
          onChange={(e) => setObservacoes(e.target.value)}
          placeholder="Lote, validade, NF, motivo..."
          maxLength={500}
        />
      </div>

      <div className="rounded-md bg-muted/40 px-3 py-2 text-xs">
        <span className="text-muted-foreground">Saldo após esta entrada: </span>
        <span className="tabular-nums font-medium text-success">{previsto}</span>
      </div>

      <div className="flex items-center justify-between gap-2 pt-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Outro código
        </Button>
        <Button onClick={salvar} disabled={criar.isPending || qtdNum <= 0}>
          {criar.isPending ? "Registrando..." : "Registrar entrada"}
        </Button>
      </div>
    </div>
  );
}

/* ============================================================================
 * Form: produto NÃO EXISTE → cadastrar + registrar primeira entrada
 * ============================================================================ */

function EntryNewForm({
  codigo,
  external,
  externalChecked,
  onBack,
  onSuccess,
}: {
  codigo: string;
  external: ProdutoExterno | null;
  externalChecked: boolean;
  onBack: () => void;
  onSuccess: () => void;
}) {
  const { data: categorias = [] } = useCategorias();
  const { data: fornecedores = [] } = useFornecedores();
  const { data: produtos = [] } = useProdutos();
  const createProduto = useCreateProduto();
  const criarMov = useCriarMovimentacao();

  // Detecta se o código é um QR code (não numérico EAN/UPC) ou barcode
  const isBarcode = /^\d{8,14}$/.test(codigo.trim());

  const [nome, setNome] = useState("");
  const [marca, setMarca] = useState("");
  const [descricao, setDescricao] = useState("");
  const [categoriaId, setCategoriaId] = useState<string>("none");
  const [unidade, setUnidade] = useState("UN");
  const [precoCusto, setPrecoCusto] = useState("");
  const [precoVenda, setPrecoVenda] = useState("");
  const [quantidade, setQuantidade] = useState("1");
  const [fornecedorId, setFornecedorId] = useState<string>("none");

  // Aplica sugestão da API quando ela chega
  useEffect(() => {
    if (external) {
      setNome((cur) => cur || external.nome);
      setMarca((cur) => cur || external.marca || "");
      setDescricao((cur) => cur || external.descricao || external.quantidade || "");
    }
  }, [external]);

  // Gera SKU automático único na empresa
  function gerarSku(): string {
    const base = isBarcode ? codigo.trim() : "P" + Date.now().toString().slice(-8);
    const skuExistentes = new Set(produtos.map((p) => p.sku));
    if (!skuExistentes.has(base)) return base;
    let i = 1;
    while (skuExistentes.has(`${base}-${i}`)) i++;
    return `${base}-${i}`;
  }

  async function salvar() {
    const nomeT = nome.trim();
    if (nomeT.length < 2) return toast.error("Informe o nome do produto.");
    const qtdNum = Number(quantidade) || 0;
    if (qtdNum <= 0) return toast.error("Informe a quantidade inicial.");
    const custoNum = Number(precoCusto) || 0;
    const vendaNum = Number(precoVenda) || 0;

    try {
      // 1. Cria o produto (estoque_inicial = 0; vamos registrar a movimentação à parte
      //    para anexar fornecedor/observação)
      const sku = gerarSku();
      const novo = await createProduto.mutateAsync({
        sku,
        codigo_barras: isBarcode ? codigo.trim() : null,
        qr_code: !isBarcode ? codigo.trim() : null,
        codigo_interno: null,
        tipo_identificacao_principal: isBarcode ? "codigo_barras" : "qr_code",
        observacao_tecnica: null,
        nome: nomeT,
        descricao: descricao.trim() || null,
        marca: marca.trim() || null,
        unidade: unidade.trim() || "UN",
        categoria_id: categoriaId !== "none" ? categoriaId : null,
        preco_custo: custoNum,
        preco_venda: vendaNum,
        estoque_minimo: 0,
        estoque_inicial: 0,
        status: "ativo",
        ncm: null,
      });

      // 2. Registra a entrada inicial
      const fornecedorTexto =
        fornecedorId !== "none"
          ? fornecedores.find((f) => f.id === fornecedorId)?.razao_social
          : null;
      const obsFinal = [
        `Entrada inicial via leitura (${codigo})`,
        fornecedorTexto ? `Fornecedor: ${fornecedorTexto}` : null,
        external ? `Pré-cadastro a partir de ${external.fonte}` : null,
      ]
        .filter(Boolean)
        .join(" · ");

      await criarMov.mutateAsync({
        produto_id: (novo as { id: string }).id,
        tipo: "entrada",
        quantidade: qtdNum,
        custo_unitario: custoNum || null,
        observacoes: obsFinal,
        saldo_atual: 0,
        origem: "inventario",
      });

      onSuccess();
    } catch {
      /* toast tratado */
    }
  }

  const carregando = !externalChecked;

  return (
    <div className="space-y-4 px-5 py-5">
      {/* Banner do código + status busca externa */}
      <Card
        className={cn(
          "p-3",
          external
            ? "border-primary/40 bg-primary/5"
            : carregando
              ? "border-border bg-muted/30"
              : "border-warning/40 bg-warning/5",
        )}
      >
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-md",
              external
                ? "bg-primary/15 text-primary"
                : carregando
                  ? "bg-muted text-muted-foreground"
                  : "bg-warning/15 text-warning",
            )}
          >
            {carregando ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : external ? (
              <Sparkles className="h-5 w-5" />
            ) : (
              <AlertTriangle className="h-5 w-5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Código lido</p>
            <p className="font-mono text-sm font-medium">{codigo}</p>
            <p className="mt-1 text-xs">
              {carregando && "Consultando base externa…"}
              {!carregando && external && (
                <span className="text-primary">
                  Sugestão de {external.fonte === "openfoodfacts" ? "Open Food Facts" : external.fonte}
                  {external.quantidade ? ` · ${external.quantidade}` : ""}
                </span>
              )}
              {!carregando && !external && (
                <span className="text-muted-foreground">
                  Sem retorno externo — preencha os dados manualmente.
                </span>
              )}
            </p>
          </div>
          {external?.imagem_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={external.imagem_url}
              alt={external.nome}
              className="h-14 w-14 shrink-0 rounded-md object-cover ring-1 ring-border"
            />
          )}
        </div>
      </Card>

      <div className="space-y-1.5">
        <Label>Nome do produto *</Label>
        <Input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex.: Café torrado 250g"
          maxLength={200}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Marca</Label>
          <Input value={marca} onChange={(e) => setMarca(e.target.value)} maxLength={100} />
        </div>
        <div className="space-y-1.5">
          <Label>Categoria</Label>
          <Select value={categoriaId} onValueChange={setCategoriaId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— Sem categoria —</SelectItem>
              {categorias.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label>Unidade</Label>
          <Input value={unidade} onChange={(e) => setUnidade(e.target.value)} maxLength={10} />
        </div>
        <div className="space-y-1.5">
          <Label>Custo</Label>
          <Input
            type="number"
            step="0.01"
            min={0}
            value={precoCusto}
            onChange={(e) => setPrecoCusto(e.target.value)}
            placeholder="R$"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Preço venda</Label>
          <Input
            type="number"
            step="0.01"
            min={0}
            value={precoVenda}
            onChange={(e) => setPrecoVenda(e.target.value)}
            placeholder="R$"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/20 p-3">
        <div className="space-y-1.5">
          <Label>Quantidade inicial *</Label>
          <Input
            type="number"
            step="0.001"
            min={0}
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Fornecedor</Label>
          <Select value={fornecedorId} onValueChange={setFornecedorId}>
            <SelectTrigger>
              <SelectValue placeholder="Opcional" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— Sem fornecedor —</SelectItem>
              {fornecedores.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.razao_social}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Outro código
        </Button>
        <Button
          onClick={salvar}
          disabled={createProduto.isPending || criarMov.isPending}
        >
          {createProduto.isPending || criarMov.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Salvando…
            </>
          ) : (
            <>
              <PackagePlus className="h-4 w-4" /> Cadastrar e dar entrada
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

