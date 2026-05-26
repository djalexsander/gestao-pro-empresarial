import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import {
  Printer,
  Loader2,
  Search,
  Check,
  ChevronsUpDown,
  X,
  Tag as TagIcon,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

import { useProdutos } from "@/hooks/useProdutos";
import { validarEan13 } from "@/lib/barcode";
import { isDesktop } from "@/integrations/data/mode";
import {
  getLabelPrinter,
  setLabelPrinter,
  getLabelFormat,
  setLabelFormat,
  getLabelCustomFormats,
  addLabelCustomFormat,
  printLabelImage,
} from "@/integrations/desktop/printers";
import { subscribeDesktopConfig } from "@/integrations/desktop/configStore";
import { PrinterPickerDialog } from "@/components/desktop/PrinterPickerDialog";

export const Route = createFileRoute("/etiquetas")({
  component: EtiquetasPage,
});

// ---------------------------------------------------------------------------
// Tipos e presets de formato
// ---------------------------------------------------------------------------

type TipoEtiqueta = "produto" | "prateleira" | "personalizada";

interface FormatoInfo {
  label: string;
  w: number;
  h: number;
}

const FORMATOS_BASE: Record<string, FormatoInfo> = {
  "40x30": { label: "Pequena 40×30 mm", w: 40, h: 30 },
  "50x30": { label: "Pequena 50×30 mm", w: 50, h: 30 },
  "50x40": { label: "Média 50×40 mm", w: 50, h: 40 },
  "60x40": { label: "Média 60×40 mm", w: 60, h: 40 },
  "80x40": { label: "Grande 80×40 mm", w: 80, h: 40 },
  "100x50": { label: "Gôndola 100×50 mm", w: 100, h: 50 },
  "100x70": { label: "Gôndola 100×70 mm", w: 100, h: 70 },
};

function getFormatoInfo(formato: string): FormatoInfo {
  const fixed = FORMATOS_BASE[formato];
  if (fixed) return fixed;
  const match = /^(\d{2,3})x(\d{2,3})$/i.exec(formato.trim());
  if (match) {
    const w = Number(match[1]);
    const h = Number(match[2]);
    return { label: `Personalizada ${w}×${h} mm`, w, h };
  }
  return FORMATOS_BASE["50x30"];
}

// ---------------------------------------------------------------------------
// Configuração de etiqueta (independente do cadastro do produto)
// ---------------------------------------------------------------------------

interface EtiquetaConfig {
  tipo: TipoEtiqueta;
  nome: string;
  preco: number | null;
  codigo: string;
  unidade: string;
  observacao: string;
  mostrarNome: boolean;
  mostrarPreco: boolean;
  mostrarCodigo: boolean;
  mostrarQr: boolean;
  mostrarUnidade: boolean;
  mostrarObservacao: boolean;
  fontNomePct: number;
  fontPrecoPct: number;
  formato: string;
  copias: number;
}

const CONFIG_INICIAL: EtiquetaConfig = {
  tipo: "produto",
  nome: "",
  preco: null,
  codigo: "",
  unidade: "UN",
  observacao: "",
  mostrarNome: true,
  mostrarPreco: true,
  mostrarCodigo: true,
  mostrarQr: false,
  mostrarUnidade: false,
  mostrarObservacao: false,
  fontNomePct: 100,
  fontPrecoPct: 100,
  formato: "50x30",
  copias: 1,
};

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

function EtiquetasPage() {
  const desktop = isDesktop();
  const { data: produtos = [], isLoading: loadingProdutos } = useProdutos();

  const [cfg, setCfg] = useState<EtiquetaConfig>(() => ({
    ...CONFIG_INICIAL,
    formato: getLabelFormat() || CONFIG_INICIAL.formato,
  }));
  const [labelPrinter, setLP] = useState<string | null>(getLabelPrinter());
  const [customFormats, setCustomFormats] = useState<string[]>(
    getLabelCustomFormats(),
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [imprimindo, setImprimindo] = useState(false);
  const [pickerProduto, setPickerProduto] = useState(false);
  const [novaLargura, setNovaLargura] = useState("");
  const [novaAltura, setNovaAltura] = useState("");

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    return subscribeDesktopConfig((c) => {
      setLP(c.labelPrinter ?? null);
      setCustomFormats(
        (c.labelCustomFormats ?? []).filter((v) =>
          /^\d{2,3}x\d{2,3}$/i.test(v),
        ),
      );
    });
  }, []);

  useEffect(() => {
    setLabelFormat(cfg.formato);
  }, [cfg.formato]);

  // Re-renderiza o preview sempre que algo muda.
  useEffect(() => {
    let cancelado = false;
    void renderEtiqueta(cfg).then((png) => {
      if (cancelado || !previewCanvasRef.current) return;
      const img = new Image();
      img.onload = () => {
        if (cancelado || !previewCanvasRef.current) return;
        const canvas = previewCanvasRef.current;
        const fmt = getFormatoInfo(cfg.formato);
        // 4 px por mm é suficiente para preview, mantendo respeito à proporção real.
        const previewPxPerMm = 4;
        canvas.width = Math.round(fmt.w * previewPxPerMm);
        canvas.height = Math.round(fmt.h * previewPxPerMm);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }));
    });
    return () => {
      cancelado = true;
    };
  }, [cfg]);

  const formatosDisponiveis = useMemo(() => {
    const base = Object.entries(FORMATOS_BASE);
    const extras = customFormats
      .filter((v) => !FORMATOS_BASE[v])
      .map((v) => [v, getFormatoInfo(v)] as const);
    return [...base, ...extras];
  }, [customFormats]);

  function selecionarProduto(produtoId: string) {
    const p = produtos.find((x) => x.id === produtoId);
    if (!p) return;
    setCfg((s) => ({
      ...s,
      nome: p.nome ?? "",
      preco: p.preco_venda ?? null,
      codigo: p.codigo_barras ?? p.qr_code ?? p.sku ?? "",
      unidade: p.unidade ?? s.unidade,
    }));
    setPickerProduto(false);
    toast.success("Produto carregado na etiqueta.");
  }

  function limparCampos() {
    setCfg((s) => ({
      ...s,
      nome: "",
      preco: null,
      codigo: "",
      observacao: "",
    }));
  }

  function adicionarFormatoPersonalizado() {
    const w = Number(novaLargura);
    const h = Number(novaAltura);
    if (!w || !h || w < 10 || h < 10 || w > 300 || h > 300) {
      toast.error("Informe largura e altura entre 10 e 300 mm.");
      return;
    }
    const key = `${w}x${h}`;
    addLabelCustomFormat(key);
    setCustomFormats((prev) => (prev.includes(key) ? prev : [...prev, key]));
    setCfg((s) => ({ ...s, formato: key }));
    setNovaLargura("");
    setNovaAltura("");
    toast.success(`Formato ${w}×${h} mm adicionado.`);
  }

  async function imprimir() {
    if (!cfg.nome.trim() && !cfg.codigo.trim() && cfg.preco == null) {
      toast.error("Preencha pelo menos nome, preço ou código.");
      return;
    }
    if (cfg.tipo === "produto" && cfg.mostrarCodigo && !cfg.codigo.trim()) {
      toast.error("Esta etiqueta usa código de barras — informe o código.");
      return;
    }
    setImprimindo(true);
    try {
      if (desktop) {
        if (!labelPrinter) {
          toast.error(
            "Configure a impressora de etiquetas (Configurações → Impressoras).",
          );
          setPickerOpen(true);
          return;
        }
        const png = await renderEtiqueta(cfg);
        await printLabelImage(png, labelPrinter, cfg.copias);
        toast.success(
          `Etiqueta enviada para "${labelPrinter}" (${cfg.copias} cópia${cfg.copias > 1 ? "s" : ""}).`,
        );
      } else {
        await printViaBrowser(cfg);
      }
    } catch (e) {
      console.error("[etiquetas] falha ao imprimir", e);
      toast.error(
        "Não foi possível imprimir. Verifique a impressora e tente novamente.",
      );
    } finally {
      setImprimindo(false);
    }
  }

  const usaCodigo = cfg.tipo === "produto";
  const ehPrateleira = cfg.tipo === "prateleira";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Etiquetas"
        description="Central de criação e impressão de etiquetas — produto, gôndola e personalizada."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Coluna esquerda: editor */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tipo de etiqueta</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs
                value={cfg.tipo}
                onValueChange={(v) => {
                  const tipo = v as TipoEtiqueta;
                  setCfg((s) => ({
                    ...s,
                    tipo,
                    mostrarCodigo: tipo === "produto" ? true : false,
                    mostrarQr: tipo === "produto" ? s.mostrarQr : false,
                    mostrarUnidade: tipo === "prateleira" ? true : s.mostrarUnidade,
                  }));
                }}
              >
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="produto">Produto (c/ código)</TabsTrigger>
                  <TabsTrigger value="prateleira">Prateleira/Gôndola</TabsTrigger>
                  <TabsTrigger value="personalizada">Personalizada</TabsTrigger>
                </TabsList>
              </Tabs>
              <p className="mt-3 text-xs text-muted-foreground">
                {cfg.tipo === "produto" &&
                  "Etiqueta de produto com nome, preço e código de barras (ou QR Code)."}
                {cfg.tipo === "prateleira" &&
                  "Etiqueta de gôndola com preço em destaque e nome — sem código de barras."}
                {cfg.tipo === "personalizada" &&
                  "Você define livremente texto, preço, observação e se mostra ou não código."}
              </p>
            </CardContent>
          </Card>

          {(cfg.tipo === "produto" || cfg.tipo === "prateleira") && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Buscar produto</CardTitle>
                <Button variant="ghost" size="sm" onClick={limparCampos}>
                  <X className="mr-1 h-3.5 w-3.5" /> Limpar
                </Button>
              </CardHeader>
              <CardContent>
                <Popover open={pickerProduto} onOpenChange={setPickerProduto}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="w-full justify-between"
                    >
                      <span className="flex items-center gap-2 truncate">
                        <Search className="h-4 w-4 text-muted-foreground" />
                        {cfg.nome
                          ? cfg.nome
                          : "Pesquisar por nome, SKU ou código…"}
                      </span>
                      <ChevronsUpDown className="h-4 w-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[min(560px,90vw)] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Pesquisar produto…" />
                      <CommandList>
                        <CommandEmpty>
                          {loadingProdutos ? "Carregando…" : "Nenhum produto."}
                        </CommandEmpty>
                        <CommandGroup>
                          {produtos.slice(0, 200).map((p) => (
                            <CommandItem
                              key={p.id}
                              value={`${p.nome} ${p.sku ?? ""} ${p.codigo_barras ?? ""}`}
                              onSelect={() => selecionarProduto(p.id)}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  cfg.nome === p.nome
                                    ? "opacity-100"
                                    : "opacity-0",
                                )}
                              />
                              <div className="flex flex-1 items-center justify-between gap-2 overflow-hidden">
                                <div className="min-w-0">
                                  <div className="truncate text-sm">
                                    {p.nome}
                                  </div>
                                  <div className="truncate text-[11px] text-muted-foreground">
                                    {p.sku ?? "—"}
                                    {p.codigo_barras
                                      ? ` · ${p.codigo_barras}`
                                      : ""}
                                  </div>
                                </div>
                                {p.preco_venda != null && (
                                  <Badge variant="secondary" className="shrink-0">
                                    R${" "}
                                    {Number(p.preco_venda)
                                      .toFixed(2)
                                      .replace(".", ",")}
                                  </Badge>
                                )}
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Os dados ficam editáveis abaixo. Alterações aqui{" "}
                  <strong>não</strong> afetam o cadastro do produto.
                </p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Conteúdo da etiqueta</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="etq-nome">Nome / Título</Label>
                  <Input
                    id="etq-nome"
                    value={cfg.nome}
                    onChange={(e) =>
                      setCfg((s) => ({ ...s, nome: e.target.value }))
                    }
                    placeholder="Nome do produto ou texto principal"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="etq-preco">Preço (R$)</Label>
                  <Input
                    id="etq-preco"
                    type="number"
                    step="0.01"
                    min={0}
                    value={cfg.preco ?? ""}
                    onChange={(e) =>
                      setCfg((s) => ({
                        ...s,
                        preco:
                          e.target.value === "" ? null : Number(e.target.value),
                      }))
                    }
                    placeholder="0,00"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="etq-unidade">Unidade</Label>
                  <Input
                    id="etq-unidade"
                    value={cfg.unidade}
                    onChange={(e) =>
                      setCfg((s) => ({ ...s, unidade: e.target.value }))
                    }
                    placeholder="UN, KG, L…"
                  />
                </div>
                {usaCodigo && (
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="etq-codigo">Código de barras / QR</Label>
                    <Input
                      id="etq-codigo"
                      value={cfg.codigo}
                      onChange={(e) =>
                        setCfg((s) => ({ ...s, codigo: e.target.value }))
                      }
                      placeholder="EAN-13 ou CODE-128"
                    />
                  </div>
                )}
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="etq-obs">Observação / descrição curta</Label>
                  <Textarea
                    id="etq-obs"
                    rows={2}
                    value={cfg.observacao}
                    onChange={(e) =>
                      setCfg((s) => ({ ...s, observacao: e.target.value }))
                    }
                    placeholder='Ex.: "Promoção", "Validade 30 dias", "Embalagem 500g"'
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={cfg.mostrarNome}
                    onCheckedChange={(v) =>
                      setCfg((s) => ({ ...s, mostrarNome: Boolean(v) }))
                    }
                  />
                  Mostrar nome
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={cfg.mostrarPreco}
                    onCheckedChange={(v) =>
                      setCfg((s) => ({ ...s, mostrarPreco: Boolean(v) }))
                    }
                  />
                  Mostrar preço
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={cfg.mostrarUnidade}
                    onCheckedChange={(v) =>
                      setCfg((s) => ({ ...s, mostrarUnidade: Boolean(v) }))
                    }
                  />
                  Mostrar unidade
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={cfg.mostrarObservacao}
                    onCheckedChange={(v) =>
                      setCfg((s) => ({ ...s, mostrarObservacao: Boolean(v) }))
                    }
                  />
                  Mostrar observação
                </label>
                <label
                  className={cn(
                    "flex items-center gap-2 text-sm",
                    ehPrateleira && "opacity-50",
                  )}
                >
                  <Checkbox
                    disabled={ehPrateleira}
                    checked={cfg.mostrarCodigo}
                    onCheckedChange={(v) =>
                      setCfg((s) => ({ ...s, mostrarCodigo: Boolean(v) }))
                    }
                  />
                  Mostrar código de barras
                </label>
                <label
                  className={cn(
                    "flex items-center gap-2 text-sm",
                    ehPrateleira && "opacity-50",
                  )}
                >
                  <Checkbox
                    disabled={ehPrateleira}
                    checked={cfg.mostrarQr}
                    onCheckedChange={(v) =>
                      setCfg((s) => ({ ...s, mostrarQr: Boolean(v) }))
                    }
                  />
                  Mostrar QR Code
                </label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Formato e impressão</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1.5 md:col-span-2">
                  <Label>Tamanho da etiqueta</Label>
                  <Select
                    value={cfg.formato}
                    onValueChange={(v) =>
                      setCfg((s) => ({ ...s, formato: v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {formatosDisponiveis.map(([k, f]) => (
                        <SelectItem key={k} value={k}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Cópias</Label>
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    value={cfg.copias}
                    onChange={(e) =>
                      setCfg((s) => ({
                        ...s,
                        copias: Math.max(
                          1,
                          Math.min(500, Number(e.target.value) || 1),
                        ),
                      }))
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Tamanho fonte do nome (%)</Label>
                  <Input
                    type="number"
                    min={50}
                    max={200}
                    value={cfg.fontNomePct}
                    onChange={(e) =>
                      setCfg((s) => ({
                        ...s,
                        fontNomePct: Math.max(
                          50,
                          Math.min(200, Number(e.target.value) || 100),
                        ),
                      }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Tamanho fonte do preço (%)</Label>
                  <Input
                    type="number"
                    min={50}
                    max={200}
                    value={cfg.fontPrecoPct}
                    onChange={(e) =>
                      setCfg((s) => ({
                        ...s,
                        fontPrecoPct: Math.max(
                          50,
                          Math.min(200, Number(e.target.value) || 100),
                        ),
                      }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">
                    Adicionar tamanho personalizado
                  </Label>
                  <div className="flex gap-1.5">
                    <Input
                      type="number"
                      placeholder="L"
                      value={novaLargura}
                      onChange={(e) => setNovaLargura(e.target.value)}
                    />
                    <Input
                      type="number"
                      placeholder="A"
                      value={novaAltura}
                      onChange={(e) => setNovaAltura(e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={adicionarFormatoPersonalizado}
                    >
                      +
                    </Button>
                  </div>
                </div>
              </div>

              {desktop && (
                <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Impressora de etiquetas
                    </div>
                    <div className="truncate">
                      {labelPrinter ? (
                        <span className="font-medium">{labelPrinter}</span>
                      ) : (
                        <span className="text-muted-foreground">
                          Nenhuma configurada
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPickerOpen(true)}
                  >
                    {labelPrinter ? "Trocar" : "Escolher"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Coluna direita: preview + ação */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TagIcon className="h-4 w-4" /> Pré-visualização
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col items-center gap-2">
                <div className="rounded-md border border-dashed border-border bg-white p-2 shadow-sm">
                  <canvas
                    ref={previewCanvasRef}
                    className="max-w-full"
                    style={{ display: "block" }}
                  />
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Tamanho real:{" "}
                  <strong>
                    {getFormatoInfo(cfg.formato).w} ×{" "}
                    {getFormatoInfo(cfg.formato).h} mm
                  </strong>{" "}
                  · {cfg.copias} cópia{cfg.copias > 1 ? "s" : ""}
                </div>
              </div>

              <Button
                className="w-full gap-2"
                onClick={() => void imprimir()}
                disabled={imprimindo}
              >
                {imprimindo ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Printer className="h-4 w-4" />
                )}
                Imprimir etiqueta
              </Button>
              {!desktop && (
                <p className="text-center text-[11px] text-muted-foreground">
                  Sem desktop instalado: a impressão usa o diálogo padrão do
                  navegador.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <PrinterPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        currentName={labelPrinter}
        onSelect={(name) => {
          setLabelPrinter(name);
          toast.success(`Impressora de etiquetas "${name}" salva.`);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Renderização da etiqueta (canvas → PNG bytes)
//
// Layout responsivo ao tipo:
//   - produto: nome (topo) → barcode/QR (centro) → preço (base)
//   - prateleira: nome (topo) → preço gigante (centro) → unidade/obs (base)
//   - personalizada: usa toggles do usuário
// ---------------------------------------------------------------------------

async function renderEtiqueta(cfg: EtiquetaConfig): Promise<Uint8Array> {
  const fmt = getFormatoInfo(cfg.formato);
  const DPI = fmt.w >= 80 ? 300 : 600;
  const PX_PER_MM = DPI / 25.4;
  const W = Math.round(fmt.w * PX_PER_MM);
  const H = Math.round(fmt.h * PX_PER_MM);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D indisponível");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000000";
  ctx.imageSmoothingEnabled = false;

  const mm = (v: number) => v * PX_PER_MM;
  const minSide = Math.min(fmt.w, fmt.h);
  const padX = mm(Math.max(1, Math.min(2.2, minSide * 0.06)));
  const padY = mm(Math.max(0.8, Math.min(1.8, minSide * 0.05)));
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;

  const showNome = cfg.mostrarNome && !!cfg.nome.trim();
  const showPreco = cfg.mostrarPreco && cfg.preco != null;
  const showObs = cfg.mostrarObservacao && !!cfg.observacao.trim();
  const showUnid = cfg.mostrarUnidade && !!cfg.unidade.trim();
  const showBarcode =
    cfg.tipo !== "prateleira" && cfg.mostrarCodigo && !!cfg.codigo.trim();
  const showQr =
    cfg.tipo !== "prateleira" && cfg.mostrarQr && !!cfg.codigo.trim();

  const ehPrateleira = cfg.tipo === "prateleira";

  // ---------- modo prateleira / gôndola (preço dominante) ----------
  if (ehPrateleira) {
    const fontPx = (px: number, pct: number) => Math.max(8, px * (pct / 100));

    const nomeBaseH = showNome ? innerH * 0.18 : 0;
    const obsBaseH = showObs ? innerH * 0.13 : 0;
    const unidBaseH = showUnid ? innerH * 0.1 : 0;
    const precoH = innerH - nomeBaseH - obsBaseH - unidBaseH;

    let y = padY;

    if (showNome) {
      const nomeFont = fontPx(nomeBaseH * 0.7, cfg.fontNomePct);
      const quebra = quebrarTexto(
        ctx,
        cfg.nome,
        innerW,
        `bold ${Math.round(nomeFont)}px Arial, sans-serif`,
        2,
      );
      ctx.font = `bold ${quebra.fontPx}px Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      quebra.lines.forEach((ln, i) => {
        ctx.fillText(
          ln,
          W / 2,
          y + i * quebra.fontPx * 1.05,
          innerW,
        );
      });
      y += nomeBaseH;
    }

    if (showPreco) {
      // Preço ocupa o coração da etiqueta de gôndola.
      const precoFont = fontPx(precoH * 0.78, cfg.fontPrecoPct);
      ctx.font = `900 ${Math.round(precoFont)}px Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        `R$ ${Number(cfg.preco).toFixed(2).replace(".", ",")}`,
        W / 2,
        y + precoH / 2,
        innerW,
      );
      y += precoH;
    }

    if (showUnid) {
      const unidFont = fontPx(unidBaseH * 0.75, 100);
      ctx.font = `bold ${Math.round(unidFont)}px Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`/ ${cfg.unidade}`, W / 2, y + unidBaseH / 2, innerW);
      y += unidBaseH;
    }

    if (showObs) {
      const obsFont = fontPx(obsBaseH * 0.7, 100);
      ctx.font = `italic ${Math.round(obsFont)}px Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(cfg.observacao, W / 2, y + obsBaseH / 2, innerW);
    }

    return await toPng(canvas);
  }

  // ---------- modo produto / personalizada ----------
  const nomeAreaH = showNome ? innerH * 0.18 : 0;
  const precoAreaH = showPreco ? innerH * 0.22 : 0;
  const obsAreaH = showObs ? innerH * 0.1 : 0;
  const centroH = innerH - nomeAreaH - precoAreaH - obsAreaH;

  let y = padY;

  if (showNome) {
    const nomeFont = Math.max(
      mm(2.2),
      Math.min(mm(3.6), nomeAreaH * 0.6) * (cfg.fontNomePct / 100),
    );
    const quebra = quebrarTexto(
      ctx,
      cfg.nome,
      innerW,
      `bold ${Math.round(nomeFont)}px Arial, sans-serif`,
      1,
    );
    ctx.font = `bold ${quebra.fontPx}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(quebra.lines[0] ?? "", W / 2, y, innerW);
    y += nomeAreaH;
  }

  // Centro: barcode + (opcional) QR
  if (showBarcode || showQr) {
    let qrCanvas: HTMLCanvasElement | null = null;
    let qrSize = 0;
    if (showQr) {
      qrSize = Math.min(centroH, innerW * 0.35);
      qrCanvas = document.createElement("canvas");
      try {
        await QRCode.toCanvas(qrCanvas, cfg.codigo, {
          margin: 0,
          width: Math.round(qrSize),
          color: { dark: "#000000", light: "#ffffff" },
        });
      } catch {
        qrCanvas = null;
        qrSize = 0;
      }
    }

    if (showBarcode) {
      const bcAreaW = qrCanvas ? innerW - qrSize - mm(1.5) : innerW * 0.8;
      const barcodeFmt = validarEan13(cfg.codigo) ? "EAN13" : "CODE128";
      const targetModules = barcodeFmt === "EAN13" ? 113 : 140;
      const barWidth = Math.max(1, Math.floor(bcAreaW / targetModules));
      const bcHeightPx = Math.max(mm(4), Math.min(centroH * 0.7, mm(16)));
      const bcCanvas = document.createElement("canvas");
      try {
        JsBarcode(bcCanvas, cfg.codigo, {
          format: barcodeFmt,
          width: barWidth,
          height: Math.round(bcHeightPx),
          displayValue: true,
          margin: 0,
          fontSize: Math.max(9, Math.round(mm(2.0))),
          textMargin: Math.max(1, Math.round(mm(0.4))),
          background: "#ffffff",
          lineColor: "#000000",
        });
      } catch {
        /* ignora */
      }
      if (bcCanvas.width > 0) {
        const scale = Math.min(
          bcAreaW / bcCanvas.width,
          centroH / bcCanvas.height,
        );
        const dw = Math.floor(bcCanvas.width * scale);
        const dh = Math.floor(bcCanvas.height * scale);
        const areaX = qrCanvas ? padX : padX + (innerW - bcAreaW) / 2;
        const dx = Math.round(areaX + (bcAreaW - dw) / 2);
        const dy = Math.round(y + (centroH - dh) / 2);
        ctx.drawImage(bcCanvas, dx, dy, dw, dh);
      }
    }

    if (qrCanvas) {
      const qx = showBarcode ? W - padX - qrSize : padX + (innerW - qrSize) / 2;
      const qy = y + Math.max(0, (centroH - qrSize) / 2);
      ctx.drawImage(qrCanvas, qx, qy, qrSize, qrSize);
    }
  } else if (showUnid && cfg.tipo === "personalizada") {
    // Espaço central livre — usa para unidade em destaque suave.
    const unidFont = Math.max(mm(3), centroH * 0.5);
    ctx.font = `bold ${Math.round(unidFont)}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(cfg.unidade, W / 2, y + centroH / 2, innerW);
  }
  y += centroH;

  if (showPreco) {
    const precoFont = Math.max(
      mm(3.6),
      Math.min(mm(7.5), precoAreaH * 0.85) * (cfg.fontPrecoPct / 100),
    );
    ctx.font = `bold ${Math.round(precoFont)}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const txt =
      `R$ ${Number(cfg.preco).toFixed(2).replace(".", ",")}` +
      (showUnid && cfg.tipo === "personalizada" ? ` / ${cfg.unidade}` : "");
    ctx.fillText(txt, W / 2, y + precoAreaH / 2, innerW);
    y += precoAreaH;
  }

  if (showObs) {
    const obsFont = Math.max(mm(1.8), obsAreaH * 0.7);
    ctx.font = `italic ${Math.round(obsFont)}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(cfg.observacao, W / 2, y + obsAreaH / 2, innerW);
  }

  return await toPng(canvas);
}

async function toPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob retornou null"))),
      "image/png",
    ),
  );
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

function quebrarTexto(
  ctx: CanvasRenderingContext2D,
  texto: string,
  maxWidth: number,
  fontCss: string,
  maxLinhas: number,
): { lines: string[]; fontPx: number } {
  const match = /(\d+(?:\.\d+)?)px/.exec(fontCss);
  let fontPx = match ? Number(match[1]) : 16;
  const baseFamily = fontCss.replace(/\d+(?:\.\d+)?px/, "FX");

  for (let tentativa = 0; tentativa < 6; tentativa++) {
    ctx.font = baseFamily.replace("FX", `${Math.round(fontPx)}px`);
    const palavras = texto.split(/\s+/).filter(Boolean);
    const linhas: string[] = [];
    let atual = "";
    for (const p of palavras) {
      const probe = atual ? `${atual} ${p}` : p;
      if (ctx.measureText(probe).width <= maxWidth) {
        atual = probe;
      } else {
        if (atual) linhas.push(atual);
        atual = p;
        if (linhas.length >= maxLinhas) break;
      }
    }
    if (atual && linhas.length < maxLinhas) linhas.push(atual);

    const couberam =
      linhas.length > 0 &&
      linhas.length <= maxLinhas &&
      linhas.every((l) => ctx.measureText(l).width <= maxWidth);
    if (couberam) return { lines: linhas, fontPx: Math.round(fontPx) };
    fontPx *= 0.9;
  }

  ctx.font = baseFamily.replace("FX", `${Math.round(fontPx)}px`);
  let s = texto;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) {
    s = s.slice(0, -1);
  }
  return { lines: [s + "…"], fontPx: Math.round(fontPx) };
}

// ---------------------------------------------------------------------------
// Fallback web: imprime via iframe usando PNG rasterizado.
// ---------------------------------------------------------------------------

async function printViaBrowser(cfg: EtiquetaConfig) {
  const fmt = getFormatoInfo(cfg.formato);
  const png = await renderEtiqueta(cfg);
  const blobUrl = URL.createObjectURL(
    new Blob([png as BlobPart], { type: "image/png" }),
  );

  const itens = Array.from({ length: cfg.copias })
    .map(
      () =>
        `<div class="etq"><img src="${blobUrl}" alt="etiqueta" /></div>`,
    )
    .join("");

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Etiqueta</title>
<style>
  @page { size: ${fmt.w}mm ${fmt.h}mm; margin: 0; }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#fff;color:#000}
  .etq{width:${fmt.w}mm;height:${fmt.h}mm;display:flex;align-items:center;justify-content:center;page-break-after:always;}
  .etq img{width:100%;height:100%;object-fit:contain;}
</style></head><body>${itens}</body></html>`;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  if (!doc) {
    document.body.removeChild(iframe);
    URL.revokeObjectURL(blobUrl);
    throw new Error("iframe sem document");
  }
  doc.open();
  doc.write(html);
  doc.close();
  const trigger = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      setTimeout(() => {
        try {
          document.body.removeChild(iframe);
        } catch {
          /* ignora */
        }
        URL.revokeObjectURL(blobUrl);
      }, 60_000);
    }
  };
  if (iframe.contentWindow?.document.readyState === "complete") {
    setTimeout(trigger, 200);
  } else {
    iframe.addEventListener("load", () => setTimeout(trigger, 200), {
      once: true,
    });
    setTimeout(trigger, 800);
  }
}
