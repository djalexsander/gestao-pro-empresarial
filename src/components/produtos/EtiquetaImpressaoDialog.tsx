import { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import { jsPDF } from "jspdf";
import { Loader2, Printer } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { validarEan13 } from "@/lib/barcode";
import { isDesktop } from "@/integrations/data/mode";
import {
  getLabelPrinter,
  setLabelPrinter,
  getLabelFormat,
  setLabelFormat,
  getLabelCustomFormats,
  printLabelImage,
} from "@/integrations/desktop/printers";
import { PrinterPickerDialog } from "@/components/desktop/PrinterPickerDialog";
import { subscribeDesktopConfig } from "@/integrations/desktop/configStore";

interface EtiquetaImpressaoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  produto: {
    nome: string;
    codigo: string;
    preco?: number | null;
    sku?: string | null;
  } | null;
}

type FormatoEtiqueta = string;

const FORMATOS: Record<
  FormatoEtiqueta,
  { label: string; w: number; h: number }
> = {
  "50x30": { label: "Etiqueta 50×30 mm", w: 50, h: 30 },
  "40x30": { label: "Etiqueta 40×30 mm", w: 40, h: 30 },
  "50x50": { label: "Etiqueta 50×50 mm", w: 50, h: 50 },
  "60x40": { label: "Etiqueta 60×40 mm", w: 60, h: 40 },
  "80x40": { label: "Etiqueta 80×40 mm", w: 80, h: 40 },
  "80mm": { label: "Etiqueta 80 mm", w: 80, h: 40 },
  "a4-grade": { label: "Folha A4 (grade)", w: 210, h: 297 },
};

function getFormatoInfo(formato: string): { label: string; w: number; h: number } {
  const fixed = FORMATOS[formato];
  if (fixed) return fixed;
  const match = /^(\d{2,3})x(\d{2,3})$/i.exec(formato.trim());
  if (match) {
    const w = Number(match[1]);
    const h = Number(match[2]);
    return { label: `Etiqueta ${w}×${h} mm`, w, h };
  }
  return FORMATOS["50x30"];
}

/**
 * Dialog para configurar e imprimir etiqueta de código de barras.
 *
 * Comportamento por plataforma:
 *   - DESKTOP (Tauri): gera PDF em memória e envia direto para a impressora
 *     de etiquetas configurada para este terminal — sem popup, sem
 *     window.print, sem bloqueio de pop-up.
 *   - WEB: fallback usando window.print() em janela isolada (comportamento
 *     anterior, preservado).
 */
export function EtiquetaImpressaoDialog({
  open,
  onOpenChange,
  produto,
}: EtiquetaImpressaoDialogProps) {
  const desktop = isDesktop();

  const [formato, setFormato] = useState<FormatoEtiqueta>(
    () => (getLabelFormat() as FormatoEtiqueta) || "50x30",
  );
  const [copias, setCopias] = useState(1);
  const [mostrarPreco, setMostrarPreco] = useState(true);
  const [mostrarNome, setMostrarNome] = useState(true);
  const [incluirQr, setIncluirQr] = useState(false);
  const [imprimindo, setImprimindo] = useState(false);
  const [labelPrinter, setLP] = useState<string | null>(getLabelPrinter());
  const [customFormats, setCustomFormats] = useState<string[]>(getLabelCustomFormats());
  const [pickerOpen, setPickerOpen] = useState(false);
  const barcodeRef = useRef<SVGSVGElement | null>(null);
  const qrRef = useRef<HTMLCanvasElement | null>(null);
  const [previewErro, setPreviewErro] = useState<string | null>(null);

  useEffect(() => {
    return subscribeDesktopConfig((cfg) => {
      setLP(cfg.labelPrinter ?? null);
      setCustomFormats(
        (cfg.labelCustomFormats ?? []).filter((v) => /^\d{2,3}x\d{2,3}$/i.test(v)),
      );
    });
  }, []);

  // Persiste o formato escolhido como padrão deste terminal.
  useEffect(() => {
    if (formato !== "a4-grade") setLabelFormat(formato);
  }, [formato]);

  // Render do preview (barcode e/ou QR). Roda sempre que muda código,
  // toggles ou formato, garantindo que o preview nunca fique em branco.
  useEffect(() => {
    if (!open) return;
    setPreviewErro(null);
    const codigo = produto?.codigo?.trim() ?? "";
    if (!codigo) {
      setPreviewErro("Produto sem código para imprimir.");
      return;
    }

    // Pequeno delay para garantir que o SVG/canvas estejam montados no DOM
    // logo após o dialog abrir (alguns ciclos de render do Radix Dialog
    // podem trocar o ref imediatamente após o open).
    const t = window.setTimeout(() => {
      // Barcode
      if (barcodeRef.current) {
        const fmt = validarEan13(codigo) ? "EAN13" : "CODE128";
        try {
          while (barcodeRef.current.firstChild) {
            barcodeRef.current.removeChild(barcodeRef.current.firstChild);
          }
          JsBarcode(barcodeRef.current, codigo, {
            format: fmt,
            width: 2,
            height: 52,
            displayValue: true,
            margin: 2,
            fontSize: 12,
            background: "#ffffff",
            lineColor: "#000000",
          });
        } catch (e) {
          console.warn("[etiqueta] falha ao renderizar barcode", e);
          setPreviewErro(
            "Código inválido para gerar barras. Verifique o código do produto.",
          );
        }
      }
      // QR (quando ativado)
      if (incluirQr && qrRef.current) {
        QRCode.toCanvas(qrRef.current, codigo, {
          margin: 0,
          width: 96,
          color: { dark: "#000000", light: "#ffffff" },
        }).catch((e) => {
          console.warn("[etiqueta] falha ao renderizar QR", e);
        });
      }
    }, 30);
    return () => window.clearTimeout(t);
  }, [open, produto?.codigo, incluirQr, mostrarNome, mostrarPreco, formato]);


  async function handlePrint() {
    if (!produto?.codigo) return;
    setImprimindo(true);
    try {
      if (desktop && formato !== "a4-grade") {
        if (!labelPrinter) {
          toast.error(
            "Configure a impressora de etiquetas antes (Configurações → Impressoras).",
          );
          setPickerOpen(true);
          return;
        }
        const png = await gerarEtiquetaPng({
          produto,
          formato,
          mostrarNome,
          mostrarPreco,
          incluirQr,
        });
        console.info("[etiqueta-print] enviando PNG/GDI", {
          impressora: labelPrinter,
          formato,
          copias,
          bytes: png.byteLength,
        });
        await printLabelImage(png, labelPrinter, copias);
        toast.success(
          `Etiqueta enviada para "${labelPrinter}" (${copias} cópia${copias > 1 ? "s" : ""}).`,
        );
        onOpenChange(false);
      } else {
        // Fallback web ou folha A4 (precisa do navegador para diagramar grade).
        printViaBrowser({
          produto,
          formato,
          copias,
          mostrarNome,
          mostrarPreco,
        });
      }
    } catch (e) {
      console.error("[etiqueta-print] falha", e);
      toast.error(
        "Não foi possível imprimir nesta impressora. Verifique se ela está ligada, instalada e definida corretamente no Windows.",
      );
    } finally {
      setImprimindo(false);
    }
  }

  const formatosDisponiveis = [
    ...Object.entries(FORMATOS),
    ...customFormats
      .filter((value) => !FORMATOS[value])
      .map((value) => [value, getFormatoInfo(value)] as const),
  ];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="h-5 w-5" /> Imprimir etiqueta
            </DialogTitle>
            <DialogDescription>{produto?.nome ?? ""}</DialogDescription>
          </DialogHeader>

          {!produto?.codigo ? (
            <p className="text-sm text-muted-foreground">
              Este produto ainda não tem código de barras. Gere ou informe um
              código primeiro.
            </p>
          ) : (
            <div className="space-y-4">
              <div
                className="rounded-md border border-border bg-white p-3 text-black"
                style={{ minHeight: 120 }}
              >
                <div className="flex flex-col items-center gap-0.5">
                  {mostrarNome && produto.nome && (
                    <div className="line-clamp-2 max-w-full text-center text-[12px] font-semibold leading-tight">
                      {produto.nome}
                    </div>
                  )}
                  <div
                    className="flex w-full items-center justify-center gap-3"
                    style={{ minHeight: 72 }}
                  >
                    <svg
                      ref={barcodeRef}
                      className="block max-h-[70px] w-auto"
                      style={{ maxWidth: "80%", minHeight: 56 }}
                    />
                    {incluirQr && (
                      <canvas
                        ref={qrRef}
                        className="block h-[64px] w-[64px]"
                      />
                    )}
                  </div>
                  {mostrarPreco && produto.preco != null && (
                    <div className="text-lg font-extrabold leading-none">
                      R$ {Number(produto.preco).toFixed(2).replace(".", ",")}
                    </div>
                  )}
                  {previewErro && (
                    <div className="mt-1 w-full rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-center text-[11px] text-amber-800">
                      {previewErro}
                    </div>
                  )}
                </div>
              </div>

              {desktop && (
                <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <div className="uppercase tracking-wide text-[10px] text-muted-foreground">
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

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Formato</Label>
                  <Select
                    value={formato}
                    onValueChange={(v) => setFormato(v as FormatoEtiqueta)}
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
                  {desktop && formato === "a4-grade" && (
                    <Badge variant="secondary" className="text-[10px]">
                      A4 usa janela do navegador
                    </Badge>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Cópias</Label>
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    value={copias}
                    onChange={(e) =>
                      setCopias(
                        Math.max(1, Math.min(500, Number(e.target.value) || 1)),
                      )
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={mostrarNome}
                    onCheckedChange={(v) => setMostrarNome(Boolean(v))}
                  />
                  Incluir nome do produto
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={mostrarPreco}
                    onCheckedChange={(v) => setMostrarPreco(Boolean(v))}
                  />
                  Incluir preço
                  {produto.preco == null && (
                    <span className="text-xs text-muted-foreground">
                      (produto sem preço)
                    </span>
                  )}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={incluirQr}
                    onCheckedChange={(v) => setIncluirQr(Boolean(v))}
                    disabled={formato === "a4-grade"}
                  />
                  Incluir QR Code
                </label>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
            <Button
              onClick={() => void handlePrint()}
              disabled={!produto?.codigo || imprimindo}
              className="gap-1.5"
            >
              {imprimindo ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Printer className="h-4 w-4" />
              )}
              Imprimir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PrinterPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        currentName={labelPrinter}
        onSelect={(name) => {
          setLabelPrinter(name);
          toast.success(`Impressora de etiquetas "${name}" salva.`);
        }}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Geração de PNG (desktop — GDI/Windows)                                      */
/* -------------------------------------------------------------------------- */

interface GerarPngArgs {
  produto: { nome: string; codigo: string; preco?: number | null };
  formato: string;
  mostrarNome: boolean;
  mostrarPreco: boolean;
  incluirQr: boolean;
}

/**
 * Renderiza a etiqueta em um canvas off-screen e devolve PNG (Uint8Array).
 *
 * Estratégia:
 * - Resolução real ≈ 600 DPI (≈23,62 px/mm). Para etiquetas grandes (largura
 *   ≥ 80 mm) cai para ~300 DPI para o PNG não ficar absurdo.
 * - Layout 100% proporcional ao tamanho em mm (50x50, 50x40, 50x30, 30x20,
 *   etc.) — nada de posições fixas.
 * - Áreas: nome (topo) → barcode/QR (meio) → preço (base).
 * - Barcode ocupa ~80% da largura útil, centralizado, com quiet zone lateral.
 * - imageSmoothingEnabled = false para que as barras saiam nítidas (sem
 *   serrilhado de filtro bilinear).
 */
async function gerarEtiquetaPng(args: GerarPngArgs): Promise<Uint8Array> {
  const { produto, formato, mostrarNome, mostrarPreco, incluirQr } = args;
  const fmt = getFormatoInfo(formato);

  // ~600 DPI em etiquetas pequenas/médias; ~300 DPI em etiquetas grandes.
  const DPI = fmt.w >= 80 ? 300 : 600;
  const PX_PER_MM = DPI / 25.4;

  const W = Math.round(fmt.w * PX_PER_MM);
  const H = Math.round(fmt.h * PX_PER_MM);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D indisponível");

  // Fundo branco puro, tinta preta pura.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000000";
  // Desliga suavização — fundamental para barras nítidas em térmica.
  ctx.imageSmoothingEnabled = false;

  const mm = (v: number) => v * PX_PER_MM;

  // Margens proporcionais ao menor lado da etiqueta.
  const minSide = Math.min(fmt.w, fmt.h);
  const padMmX = Math.max(1, Math.min(2.2, minSide * 0.06));
  const padMmY = Math.max(0.8, Math.min(1.8, minSide * 0.05));
  const padX = mm(padMmX);
  const padY = mm(padMmY);

  const innerW = W - padX * 2;
  const innerH = H - padY * 2;

  const showNome = mostrarNome && !!produto.nome;
  const showPreco = mostrarPreco && produto.preco != null;

  // Preço bem maior que o nome — é a info que o cliente lê de longe.
  const nomeFontPx = showNome
    ? Math.max(mm(2.2), Math.min(mm(3.6), innerH * 0.13))
    : 0;
  const precoFontPx = showPreco
    ? Math.max(mm(3.2), Math.min(mm(6.0), innerH * 0.22))
    : 0;

  const nomeAreaH = showNome ? nomeFontPx * 2.1 : 0;
  const precoAreaH = showPreco ? precoFontPx * 1.25 : 0;

  // Pequenos gaps para aproximar o nome do código.
  const gapNomeBarcode = showNome ? mm(0.4) : 0;
  const gapBarcodePreco = showPreco ? mm(0.6) : 0;

  const barcodeAreaY = padY + nomeAreaH + gapNomeBarcode;
  const barcodeAreaH =
    innerH - nomeAreaH - precoAreaH - gapNomeBarcode - gapBarcodePreco;

  // -------- Nome --------
  if (showNome) {
    const quebra = quebrarTexto(
      ctx,
      produto.nome,
      innerW,
      `bold ${Math.round(nomeFontPx)}px Arial, sans-serif`,
      2,
    );
    const fontFinal = quebra.fontPx;
    ctx.font = `bold ${fontFinal}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const totalH = quebra.lines.length * fontFinal * 1.05;
    const startY = padY + Math.max(0, (nomeAreaH - totalH) / 2);
    quebra.lines.forEach((ln, i) => {
      ctx.fillText(ln, W / 2, startY + i * fontFinal * 1.05, innerW);
    });
  }

  // -------- QR opcional (lado direito da área central) --------
  let qrCanvas: HTMLCanvasElement | null = null;
  let qrSize = 0;
  if (incluirQr) {
    qrSize = Math.min(barcodeAreaH, innerW * 0.35);
    qrCanvas = document.createElement("canvas");
    try {
      await QRCode.toCanvas(qrCanvas, produto.codigo, {
        margin: 0,
        width: Math.round(qrSize),
        color: { dark: "#000000", light: "#ffffff" },
      });
    } catch {
      qrCanvas = null;
      qrSize = 0;
    }
  }

  // -------- Barcode --------
  // Etiquetas estreitas (≤30 mm) usam fração menor para preservar quiet zone.
  const barcodeFrac = fmt.w <= 30 ? 0.72 : 0.8;
  const bcAreaW = qrCanvas
    ? innerW - qrSize - mm(1.5)
    : innerW * barcodeFrac;

  const barcodeFmt = validarEan13(produto.codigo) ? "EAN13" : "CODE128";

  const bcCanvas = document.createElement("canvas");
  // Largura da barra fina em px (módulo). EAN13 ≈ 113 módulos com texto.
  const targetModules = barcodeFmt === "EAN13" ? 113 : 140;
  const barWidth = Math.max(1, Math.floor(bcAreaW / targetModules));
  const bcHeightPx = Math.max(mm(6), Math.min(barcodeAreaH * 0.78, mm(22)));
  const bcFontSize = Math.max(
    10,
    Math.min(Math.round(mm(2.2)), Math.round(precoFontPx * 0.55) || 999),
  );

  try {
    JsBarcode(bcCanvas, produto.codigo, {
      format: barcodeFmt,
      width: barWidth,
      height: Math.round(bcHeightPx),
      displayValue: true,
      margin: 0,
      fontSize: bcFontSize,
      textMargin: Math.max(1, Math.round(mm(0.4))),
      background: "#ffffff",
      lineColor: "#000000",
    });
  } catch {
    // Mantém o canvas em branco para não quebrar layout.
  }

  if (bcCanvas.width > 0 && bcCanvas.height > 0 && barcodeAreaH > 0) {
    const scale = Math.min(
      bcAreaW / bcCanvas.width,
      barcodeAreaH / bcCanvas.height,
    );
    const dw = Math.floor(bcCanvas.width * scale);
    const dh = Math.floor(bcCanvas.height * scale);
    const areaX = qrCanvas ? padX : padX + (innerW - bcAreaW) / 2;
    const dx = Math.round(areaX + (bcAreaW - dw) / 2);
    const dy = Math.round(barcodeAreaY + (barcodeAreaH - dh) / 2);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bcCanvas, dx, dy, dw, dh);
  }

  if (qrCanvas) {
    const qx = W - padX - qrSize;
    const qy = barcodeAreaY + Math.max(0, (barcodeAreaH - qrSize) / 2);
    ctx.drawImage(qrCanvas, qx, qy, qrSize, qrSize);
  }

  // -------- Preço (base) --------
  if (showPreco) {
    const fontPx = Math.round(precoFontPx);
    ctx.font = `bold ${fontPx}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      `R$ ${Number(produto.preco).toFixed(2).replace(".", ",")}`,
      W / 2,
      H - padY,
      innerW,
    );
  }

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob retornou null"))),
      "image/png",
    );
  });
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Quebra um texto em até `maxLinhas` linhas que caibam em `maxWidth`. Se mesmo
 * em `maxLinhas` linhas o nome não couber, reduz a fonte progressivamente.
 */
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

  // Fallback: trunca com elipse.
  ctx.font = baseFamily.replace("FX", `${Math.round(fontPx)}px`);
  let s = texto;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) {
    s = s.slice(0, -1);
  }
  return { lines: [s + "…"], fontPx: Math.round(fontPx) };
}

/* -------------------------------------------------------------------------- */
/* Geração de PDF (mantido para fallback A4-grade via navegador)               */
/* -------------------------------------------------------------------------- */

interface GerarPdfArgs {
  produto: { nome: string; codigo: string; preco?: number | null };
  formato: string;
  copias: number;
  mostrarNome: boolean;
  mostrarPreco: boolean;
  incluirQr: boolean;
}

// Mantido apenas para referência / casos futuros. Não é mais chamado pelo
// fluxo desktop de etiquetas (substituído pelo PNG/GDI).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function gerarEtiquetaPdf(args: GerarPdfArgs): Promise<Uint8Array> {
  const { produto, formato, copias, mostrarNome, mostrarPreco, incluirQr } =
    args;
  const fmt = getFormatoInfo(formato);
  const w = fmt.w;
  const h = fmt.h;

  // Gera código de barras como SVG → PNG dataURL (jsPDF aceita PNG direto).
  const barcodeFmt = validarEan13(produto.codigo) ? "EAN13" : "CODE128";
  const barcodePng = barcodeToPngDataUrl(produto.codigo, barcodeFmt);

  // QR opcional
  let qrDataUrl: string | null = null;
  if (incluirQr) {
    try {
      qrDataUrl = await QRCode.toDataURL(produto.codigo, {
        margin: 0,
        width: 256,
      });
    } catch {
      /* ignora */
    }
  }

  const doc = new jsPDF({
    unit: "mm",
    format: [w, h],
    orientation: w >= h ? "landscape" : "portrait",
  });

  for (let i = 0; i < copias; i++) {
    if (i > 0) doc.addPage([w, h], w >= h ? "landscape" : "portrait");

    const padX = 1.5;
    const padY = 1.2;
    let y = padY;

    if (mostrarNome) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      const nome = truncar(produto.nome, 30);
      doc.text(nome, w / 2, y + 2, { align: "center", maxWidth: w - padX * 2 });
      y += 3.5;
    }

    // Barcode + QR layout
    const qrSize = Math.min(h - y - padY - 4, 14);
    const barcodeW = incluirQr && qrDataUrl ? w - qrSize - padX * 3 : w - padX * 2;
    const barcodeH = Math.max(8, h - y - padY - (mostrarPreco ? 4 : 1));

    try {
      doc.addImage(
        barcodePng,
        "PNG",
        padX,
        y,
        barcodeW,
        barcodeH,
        undefined,
        "FAST",
      );
    } catch {
      /* ignora */
    }

    if (incluirQr && qrDataUrl) {
      try {
        doc.addImage(
          qrDataUrl,
          "PNG",
          w - qrSize - padX,
          y,
          qrSize,
          qrSize,
          undefined,
          "FAST",
        );
      } catch {
        /* ignora */
      }
    }

    if (mostrarPreco && produto.preco != null) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(
        `R$ ${Number(produto.preco).toFixed(2).replace(".", ",")}`,
        w / 2,
        h - padY,
        { align: "center" },
      );
    }
  }

  return new Uint8Array(doc.output("arraybuffer"));
}

function barcodeToPngDataUrl(
  codigo: string,
  fmt: "EAN13" | "CODE128",
): string {
  // Renderiza o código em um canvas off-screen e exporta como PNG.
  const canvas = document.createElement("canvas");
  try {
    JsBarcode(canvas, codigo, {
      format: fmt,
      width: 2,
      height: 60,
      displayValue: true,
      margin: 0,
      fontSize: 14,
      background: "#ffffff",
    });
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

function truncar(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/* -------------------------------------------------------------------------- */
/* Fallback web (window.print)                                                 */
/* -------------------------------------------------------------------------- */

function printViaBrowser(args: {
  produto: { nome: string; codigo: string; preco?: number | null };
  formato: FormatoEtiqueta;
  copias: number;
  mostrarNome: boolean;
  mostrarPreco: boolean;
}) {
  const { produto, formato, copias, mostrarNome, mostrarPreco } = args;
  const fmt = getFormatoInfo(formato);
  const wMm = `${fmt.w}mm`;
  const hMm = `${fmt.h}mm`;

  const fmtBarcode = validarEan13(produto.codigo) ? "EAN13" : "CODE128";
  const wrapper = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  try {
    JsBarcode(wrapper, produto.codigo, {
      format: fmtBarcode,
      width: 2,
      height: 50,
      displayValue: true,
      margin: 2,
      fontSize: 12,
      background: "#ffffff",
    });
  } catch {
    /* ignora */
  }
  const svgString = new XMLSerializer().serializeToString(wrapper);
  const isFolha = formato === "a4-grade";
  const itens = Array.from({ length: copias }, () => 1);

  const itemHtml = `
    <div class="etq">
      ${mostrarNome ? `<div class="nome">${escapeHtml(produto.nome)}</div>` : ""}
      <div class="bc">${svgString}</div>
      ${
        mostrarPreco && produto.preco != null
          ? `<div class="preco">R$ ${Number(produto.preco).toFixed(2).replace(".", ",")}</div>`
          : ""
      }
    </div>
  `;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Etiqueta — ${escapeHtml(produto.nome)}</title>
<style>
  @page { size: ${wMm} ${hMm}; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; font-family: ui-sans-serif, system-ui, sans-serif; color: #000; background: #fff; }
  .etq {
    width: ${isFolha ? "50mm" : wMm};
    height: ${isFolha ? "30mm" : hMm};
    padding: 1mm 2mm;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    page-break-inside: avoid; break-inside: avoid;
    ${isFolha ? "border: 1px dashed #ccc; margin: 1mm;" : ""}
  }
  .nome { font-size: 9pt; font-weight: 600; text-align: center; line-height: 1.1; max-height: 22%; overflow: hidden; }
  .bc { display: flex; justify-content: center; max-width: 100%; }
  .bc svg { max-width: 100%; height: auto; }
  .preco { font-size: 11pt; font-weight: 700; }
  ${isFolha ? `body { display: flex; flex-wrap: wrap; align-content: flex-start; padding: 5mm; gap: 0; }` : ""}
</style></head>
<body>
  ${itens.map(() => itemHtml).join("")}
</body></html>`;

  // Usa iframe oculto em vez de window.open — não dispara bloqueador de
  // pop-ups e funciona em qualquer navegador / no Tauri.
  try {
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
      throw new Error("iframe sem document");
    }
    doc.open();
    doc.write(html);
    doc.close();

    const trigger = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (e) {
        console.error("[etiqueta] iframe print falhou", e);
      } finally {
        setTimeout(() => {
          try {
            document.body.removeChild(iframe);
          } catch {}
        }, 60_000);
      }
    };

    if (iframe.contentWindow?.document.readyState === "complete") {
      setTimeout(trigger, 150);
    } else {
      iframe.addEventListener("load", () => setTimeout(trigger, 150), {
        once: true,
      });
      setTimeout(trigger, 700);
    }
  } catch (e) {
    console.error("[etiqueta] falha ao montar iframe", e);
    toast.error(
      "Não foi possível iniciar a impressão. Tente novamente ou gere um PDF.",
    );
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&"
      ? "&amp;"
      : c === "<"
        ? "&lt;"
        : c === ">"
          ? "&gt;"
          : c === '"'
            ? "&quot;"
            : "&#39;",
  );
}
