import { useEffect, useState } from "react";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
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
import { toast } from "sonner";
import { validarEan13 } from "@/lib/barcode";
import { isDesktop } from "@/integrations/data/mode";
import {
  getLabelPrinter,
  setLabelPrinter,
  getActiveBobinaProfile,
  getBobinaProfiles,
  getPrinterDpi,
  printLabelSheet,
  setActiveBobinaProfileId,
} from "@/integrations/desktop/printers";
import { PrinterPickerDialog } from "@/components/desktop/PrinterPickerDialog";
import { subscribeDesktopConfig } from "@/integrations/desktop/configStore";
import { formatarResumoPerfil, type PerfilBobina } from "@/lib/etiqueta-layout";
import { quebrarTexto, renderizarFolhas, type CelulaRenderContext } from "@/lib/etiqueta-render";

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

interface ConteudoProduto {
  nome: string;
  codigo: string;
  preco?: number | null;
}

interface OpcoesConteudo {
  mostrarNome: boolean;
  mostrarPreco: boolean;
  incluirQr: boolean;
}

/**
 * Dialog para configurar e imprimir etiqueta de código de barras.
 *
 * Comportamento por plataforma:
 *   - DESKTOP (Tauri): usa o perfil de bobina ativo deste terminal para
 *     montar a folha (1 linha por PNG, N colunas lado a lado) e envia via
 *     `printLabelSheet` — sem popup, sem window.print, sem bloqueio de
 *     pop-up. Segue o MESMO pipeline central de `@/lib/etiqueta-layout` e
 *     `@/lib/etiqueta-render` usado em Configurações → Impressoras e na
 *     tela /etiquetas.
 *   - WEB ou folha A4: fallback usando window.print() em janela isolada
 *     (comportamento anterior, preservado) — pipeline de DOCUMENTO, não de
 *     bobina térmica.
 */
export function EtiquetaImpressaoDialog({
  open,
  onOpenChange,
  produto,
}: EtiquetaImpressaoDialogProps) {
  const desktop = isDesktop();

  const [copias, setCopias] = useState(1);
  const [mostrarPreco, setMostrarPreco] = useState(true);
  const [mostrarNome, setMostrarNome] = useState(true);
  const [incluirQr, setIncluirQr] = useState(false);
  const [folhaA4, setFolhaA4] = useState(false);
  const [imprimindo, setImprimindo] = useState(false);
  const [labelPrinter, setLP] = useState<string | null>(getLabelPrinter());
  const [perfis, setPerfis] = useState<PerfilBobina[]>(getBobinaProfiles());
  const [perfilAtivoId, setPerfilAtivoId] = useState<string | null>(
    getActiveBobinaProfile()?.id ?? null,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  // Callback ref (não useRef): o <canvas> vive dentro de um Dialog Radix, cujo
  // Presence monta o conteúdo real um ciclo de render DEPOIS do `open` virar
  // true (troca de estado "unmounted" → "mounted" via useLayoutEffect). Um
  // useRef lido dentro do efeito de preview via `open` como dependência
  // chegaria cedo demais (ref ainda nulo) e nunca seria re-executado, pois
  // nenhuma dependência muda no ciclo seguinte. Guardar o node em estado
  // garante que o efeito rode de novo assim que o canvas realmente existir.
  const [previewCanvas, setPreviewCanvas] = useState<HTMLCanvasElement | null>(null);
  const [previewErro, setPreviewErro] = useState<string | null>(null);

  useEffect(() => {
    return subscribeDesktopConfig(() => {
      setLP(getLabelPrinter());
      setPerfis(getBobinaProfiles());
      setPerfilAtivoId(getActiveBobinaProfile()?.id ?? null);
    });
  }, []);

  const perfilAtivo = perfis.find((p) => p.id === perfilAtivoId) ?? null;

  // Preview: renderiza a linha real (perfil + colunas) pelo MESMO motor
  // usado na impressão — nunca duplica o cálculo de layout/conteúdo.
  useEffect(() => {
    if (!open) return;
    setPreviewErro(null);
    const codigo = produto?.codigo?.trim() ?? "";
    if (!codigo || !produto) {
      setPreviewErro("Produto sem código para imprimir.");
      return;
    }
    if (!perfilAtivo) {
      setPreviewErro("Nenhum perfil de bobina configurado.");
      return;
    }
    const canvas = previewCanvas;
    if (!canvas) return;

    let cancelado = false;
    const conteudo: ConteudoProduto = { nome: produto.nome, codigo, preco: produto.preco };
    const opts: OpcoesConteudo = { mostrarNome, mostrarPreco, incluirQr };
    const itens = Array.from({ length: perfilAtivo.colunas }, () => conteudo);

    void renderizarFolhas({
      perfil: perfilAtivo,
      itens,
      desenharCelula: (contexto, item) =>
        item ? desenharConteudoProduto(contexto, item, opts) : undefined,
    })
      .then((folhas) => {
        if (cancelado || folhas.length === 0) return;
        const primeira = folhas[0];
        const img = new Image();
        img.onload = () => {
          if (cancelado) return;
          const maxW = 340;
          const escala = Math.min(1, maxW / primeira.larguraDots);
          canvas.width = Math.max(1, Math.round(primeira.larguraDots * escala));
          canvas.height = Math.max(1, Math.round(primeira.alturaDots * escala));
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          ctx.imageSmoothingEnabled = true;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        img.src = URL.createObjectURL(new Blob([primeira.png as BlobPart], { type: "image/png" }));
      })
      .catch((e) => {
        console.warn("[etiqueta] falha ao renderizar preview", e);
        if (!cancelado)
          setPreviewErro("Não foi possível gerar a prévia. Verifique o código do produto.");
      });
    return () => {
      cancelado = true;
    };
  }, [open, produto, incluirQr, mostrarNome, mostrarPreco, perfilAtivo, previewCanvas]);

  async function handlePrint() {
    if (!produto?.codigo) return;
    setImprimindo(true);
    try {
      if (desktop && !folhaA4) {
        if (!labelPrinter) {
          toast.error("Configure a impressora de etiquetas antes (Configurações → Impressoras).");
          setPickerOpen(true);
          return;
        }
        if (!perfilAtivo) {
          toast.error("Nenhum perfil de bobina configurado (Configurações → Impressoras).");
          return;
        }
        const conteudo: ConteudoProduto = {
          nome: produto.nome,
          codigo: produto.codigo,
          preco: produto.preco,
        };
        const opts: OpcoesConteudo = { mostrarNome, mostrarPreco, incluirQr };
        const itens = Array.from({ length: Math.max(1, copias) }, () => conteudo);
        const dpiInfo = await getPrinterDpi(labelPrinter);
        const folhas = await renderizarFolhas({
          perfil: perfilAtivo,
          itens,
          dpiConsultado: dpiInfo?.x ?? null,
          desenharCelula: (contexto, item) =>
            item ? desenharConteudoProduto(contexto, item, opts) : undefined,
        });
        console.info("[etiqueta-print] enviando folha", {
          impressora: labelPrinter,
          perfil: perfilAtivo.nome,
          colunas: perfilAtivo.colunas,
          paginas: folhas.length,
          copias,
        });
        await printLabelSheet(
          folhas.map((f) => f.png),
          labelPrinter,
          1,
        );
        toast.success(
          `Etiqueta enviada para "${labelPrinter}" (${copias} cópia${copias > 1 ? "s" : ""}).`,
        );
        onOpenChange(false);
      } else {
        // Fallback web ou folha A4 (precisa do navegador para diagramar grade).
        printViaBrowser({ produto, copias, mostrarNome, mostrarPreco });
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
              Este produto ainda não tem código de barras. Gere ou informe um código primeiro.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-center rounded-md border border-border bg-white p-3">
                {previewErro ? (
                  <div className="flex min-h-[100px] items-center justify-center px-2 text-center text-[11px] text-amber-800">
                    {previewErro}
                  </div>
                ) : (
                  <canvas
                    ref={setPreviewCanvas}
                    className="max-w-full"
                    style={{ display: "block" }}
                  />
                )}
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
                        <span className="text-muted-foreground">Nenhuma configurada</span>
                      )}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
                    {labelPrinter ? "Trocar" : "Escolher"}
                  </Button>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Perfil de bobina</Label>
                  <Select
                    value={perfilAtivoId ?? undefined}
                    onValueChange={(v) => {
                      setActiveBobinaProfileId(v);
                      setPerfilAtivoId(v);
                    }}
                    disabled={folhaA4}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um perfil" />
                    </SelectTrigger>
                    <SelectContent>
                      {perfis.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.nome} — {formatarResumoPerfil(p)}
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
                    value={copias}
                    onChange={(e) =>
                      setCopias(Math.max(1, Math.min(500, Number(e.target.value) || 1)))
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
                    <span className="text-xs text-muted-foreground">(produto sem preço)</span>
                  )}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={incluirQr}
                    onCheckedChange={(v) => setIncluirQr(Boolean(v))}
                    disabled={folhaA4}
                  />
                  Incluir QR Code
                </label>
                {desktop && (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={folhaA4} onCheckedChange={(v) => setFolhaA4(Boolean(v))} />
                    Imprimir em folha A4 (via navegador, ignora a impressora de etiquetas)
                  </label>
                )}
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
/* Conteúdo da etiqueta (nome → barcode/QR → preço) — desenhado DENTRO da     */
/* célula fornecida pelo motor de layout (`@/lib/etiqueta-render`). Mesma     */
/* função para preview e impressão real: nunca diverge.                      */
/* -------------------------------------------------------------------------- */

async function desenharConteudoProduto(
  contexto: CelulaRenderContext,
  produto: ConteudoProduto,
  opts: OpcoesConteudo,
): Promise<void> {
  const {
    ctx,
    xDots: originX,
    yDots: originY,
    larguraDots: W,
    alturaDots: H,
    dpi,
    celula,
  } = contexto;
  const { mostrarNome, mostrarPreco, incluirQr } = opts;
  const mm = (v: number) => (v / 25.4) * dpi;

  const minSide = Math.min(celula.larguraMm, celula.alturaMm);
  const padMmX = Math.max(1, Math.min(2.2, minSide * 0.06));
  const padMmY = Math.max(0.8, Math.min(1.8, minSide * 0.05));
  const padX = mm(padMmX);
  const padY = mm(padMmY);

  const innerW = W - padX * 2;
  const innerH = H - padY * 2;

  const showNome = mostrarNome && !!produto.nome;
  const showPreco = mostrarPreco && produto.preco != null;

  const nomeFontPx = showNome ? Math.max(mm(2.2), Math.min(mm(3.6), innerH * 0.13)) : 0;
  const precoFontPx = showPreco ? Math.max(mm(3.6), Math.min(mm(7.5), innerH * 0.28)) : 0;

  const nomeAreaH = showNome ? nomeFontPx * 1.2 : 0;
  const precoAreaH = showPreco ? precoFontPx * 1.25 : 0;

  const gapNomeBarcode = showNome ? mm(0.3) : 0;
  const gapBarcodePreco = showPreco ? mm(0.8) : 0;

  const barcodeAreaY = originY + padY + nomeAreaH + gapNomeBarcode;
  const barcodeAreaH = innerH - nomeAreaH - precoAreaH - gapNomeBarcode - gapBarcodePreco;

  if (showNome) {
    const quebra = quebrarTexto(
      ctx,
      produto.nome,
      innerW,
      `bold ${Math.round(nomeFontPx)}px Arial, sans-serif`,
      1,
    );
    ctx.font = `bold ${quebra.fontPx}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const totalH = quebra.lines.length * quebra.fontPx * 1.05;
    const startY = originY + padY + Math.max(0, (nomeAreaH - totalH) / 2);
    quebra.lines.forEach((ln, i) => {
      ctx.fillText(ln, originX + W / 2, startY + i * quebra.fontPx * 1.05, innerW);
    });
  }

  let qrCanvas: HTMLCanvasElement | null = null;
  let qrSize = 0;
  if (incluirQr) {
    qrSize = Math.min(barcodeAreaH, innerW * 0.35);
    qrCanvas = document.createElement("canvas");
    try {
      await QRCode.toCanvas(qrCanvas, produto.codigo, {
        margin: 0,
        width: Math.max(1, Math.round(qrSize)),
        color: { dark: "#000000", light: "#ffffff" },
      });
    } catch {
      qrCanvas = null;
      qrSize = 0;
    }
  }

  const barcodeFrac = celula.larguraMm <= 30 ? 0.72 : 0.8;
  const bcAreaW = qrCanvas ? innerW - qrSize - mm(1.5) : innerW * barcodeFrac;
  const barcodeFmt = validarEan13(produto.codigo) ? "EAN13" : "CODE128";
  const bcCanvas = document.createElement("canvas");
  const targetModules = barcodeFmt === "EAN13" ? 113 : 140;
  const barWidth = Math.max(1, Math.floor(bcAreaW / targetModules));
  const bcHeightPx = Math.max(mm(4), Math.min(barcodeAreaH * 0.5, mm(14)));
  const bcFontSize = Math.max(
    9,
    Math.min(Math.round(mm(2.0)), Math.round(precoFontPx * 0.45) || 999),
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
    const scale = Math.min(bcAreaW / bcCanvas.width, barcodeAreaH / bcCanvas.height);
    const dw = Math.floor(bcCanvas.width * scale);
    const dh = Math.floor(bcCanvas.height * scale);
    const areaX = qrCanvas ? originX + padX : originX + padX + (innerW - bcAreaW) / 2;
    const dx = Math.round(areaX + (bcAreaW - dw) / 2);
    const dy = Math.round(barcodeAreaY + (barcodeAreaH - dh) / 2);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bcCanvas, dx, dy, dw, dh);
  }

  if (qrCanvas) {
    const qx = originX + W - padX - qrSize;
    const qy = barcodeAreaY + Math.max(0, (barcodeAreaH - qrSize) / 2);
    ctx.drawImage(qrCanvas, qx, qy, qrSize, qrSize);
  }

  if (showPreco) {
    const fontPx = Math.round(precoFontPx);
    ctx.font = `bold ${fontPx}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      `R$ ${Number(produto.preco).toFixed(2).replace(".", ",")}`,
      originX + W / 2,
      originY + H - padY,
      innerW,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Fallback web / folha A4 (window.print) — pipeline de DOCUMENTO, separado   */
/* do pipeline de bobina térmica (ver seção 14 do pedido original).          */
/* -------------------------------------------------------------------------- */

function printViaBrowser(args: {
  produto: { nome: string; codigo: string; preco?: number | null };
  copias: number;
  mostrarNome: boolean;
  mostrarPreco: boolean;
}) {
  const { produto, copias, mostrarNome, mostrarPreco } = args;

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
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; font-family: ui-sans-serif, system-ui, sans-serif; color: #000; background: #fff; }
  .etq {
    width: 50mm;
    height: 30mm;
    padding: 1mm 2mm;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    page-break-inside: avoid; break-inside: avoid;
    border: 1px dashed #ccc; margin: 1mm;
  }
  .nome { font-size: 9pt; font-weight: 600; text-align: center; line-height: 1.1; max-height: 22%; overflow: hidden; }
  .bc { display: flex; justify-content: center; max-width: 100%; }
  .bc svg { max-width: 100%; height: auto; }
  .preco { font-size: 11pt; font-weight: 700; }
  body { display: flex; flex-wrap: wrap; align-content: flex-start; padding: 5mm; gap: 0; }
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
          } catch {
            /* ignora */
          }
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
    toast.error("Não foi possível iniciar a impressão. Tente novamente ou gere um PDF.");
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
