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
  printPdfBytes,
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const barcodeRef = useRef<SVGSVGElement | null>(null);
  const qrRef = useRef<HTMLCanvasElement | null>(null);
  const [previewErro, setPreviewErro] = useState<string | null>(null);

  useEffect(() => {
    return subscribeDesktopConfig((cfg) => setLP(cfg.labelPrinter ?? null));
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
        const pdf = await gerarEtiquetaPdf({
          produto,
          formato,
          copias,
          mostrarNome,
          mostrarPreco,
          incluirQr,
        });
        console.info("[etiqueta-print] enviando", {
          impressora: labelPrinter,
          formato,
          copias,
          bytes: pdf.byteLength,
        });
        await printPdfBytes(pdf, labelPrinter);
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
                <div className="flex flex-col items-center gap-1.5">
                  {mostrarNome && produto.nome && (
                    <div className="line-clamp-2 max-w-full text-center text-[11px] font-semibold leading-tight">
                      {produto.nome}
                    </div>
                  )}
                  <div
                    className="flex w-full items-center justify-center gap-3"
                    style={{ minHeight: 72 }}
                  >
                    {/* SVG sempre montado (mesmo com erro) — JsBarcode escreve
                        dentro dele no useEffect. */}
                    <svg
                      ref={barcodeRef}
                      className="block max-h-[68px] w-auto"
                      style={{ minWidth: 120, minHeight: 56 }}
                    />
                    {incluirQr && (
                      <canvas
                        ref={qrRef}
                        className="block h-[64px] w-[64px]"
                      />
                    )}
                  </div>
                  {mostrarPreco && produto.preco != null && (
                    <div className="text-sm font-bold">
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
                      {Object.entries(FORMATOS).map(([k, f]) => (
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
/* Geração de PDF (desktop)                                                    */
/* -------------------------------------------------------------------------- */

interface GerarPdfArgs {
  produto: { nome: string; codigo: string; preco?: number | null };
  formato: Exclude<FormatoEtiqueta, "a4-grade">;
  copias: number;
  mostrarNome: boolean;
  mostrarPreco: boolean;
  incluirQr: boolean;
}

async function gerarEtiquetaPdf(args: GerarPdfArgs): Promise<Uint8Array> {
  const { produto, formato, copias, mostrarNome, mostrarPreco, incluirQr } =
    args;
  const fmt = FORMATOS[formato];
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
  const fmt = FORMATOS[formato];
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
