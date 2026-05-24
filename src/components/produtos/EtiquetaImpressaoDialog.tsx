import { useEffect, useMemo, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { jsPDF } from "jspdf";
import {
  Printer,
  Loader2,
  RotateCcw,
  Download,
  FileText,
  AlertTriangle,
} from "lucide-react";
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
  listPrinters,
  printPdfBytes,
  getDefaultLabelPrinter,
  setDefaultLabelPrinter,
  type PrinterInfo,
} from "@/integrations/desktop/printers";
import { friendlyPrintError } from "@/lib/cupom-print";

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

type FormatoEtiqueta = "50x30" | "60x40" | "80x40" | "a4-grade";

const FORMATOS: Record<
  FormatoEtiqueta,
  { label: string; wMm: number; hMm: number }
> = {
  "50x30": { label: "Etiqueta 50×30 mm", wMm: 50, hMm: 30 },
  "60x40": { label: "Etiqueta 60×40 mm", wMm: 60, hMm: 40 },
  "80x40": { label: "Etiqueta 80×40 mm", wMm: 80, hMm: 40 },
  "a4-grade": { label: "Folha A4 (grade 50×30)", wMm: 210, hMm: 297 },
};

export function EtiquetaImpressaoDialog({
  open,
  onOpenChange,
  produto,
}: EtiquetaImpressaoDialogProps) {
  const [formato, setFormato] = useState<FormatoEtiqueta>("50x30");
  const [copias, setCopias] = useState(1);
  const [mostrarPreco, setMostrarPreco] = useState(true);
  const [mostrarNome, setMostrarNome] = useState(true);

  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [selectedPrinter, setSelectedPrinter] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const previewRef = useRef<SVGSVGElement>(null);

  const bcFormat = useMemo(
    () => (produto?.codigo && validarEan13(produto.codigo) ? "EAN13" : "CODE128"),
    [produto?.codigo],
  );

  // Carrega impressoras quando abre (desktop)
  useEffect(() => {
    if (!open) return;
    setWarning(null);
    if (!isDesktop()) return;
    void carregarImpressoras();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function carregarImpressoras() {
    setLoadingPrinters(true);
    try {
      const list = await listPrinters();
      console.info("[ETIQUETA_PRINTERS]", list.map((p) => p.name));
      setPrinters(list);
      const saved = getDefaultLabelPrinter();
      if (saved && list.find((p) => p.name === saved)) {
        setSelectedPrinter(saved);
      } else if (list.length) {
        const def = list.find((p) => p.is_default) ?? list[0];
        setSelectedPrinter(def.name);
      }
    } catch (e) {
      console.warn("[ETIQUETA_PRINTERS] falha", e);
      toast.error("Falha ao listar impressoras.");
    } finally {
      setLoadingPrinters(false);
    }
  }

  // Renderiza prévia do barcode
  useEffect(() => {
    if (!open || !produto?.codigo) return;
    // Aguarda dialog montar o SVG no DOM
    const id = window.setTimeout(() => {
      const svg = previewRef.current;
      if (!svg) {
        console.warn("[ETIQUETA_PREVIEW] svg ref ausente");
        return;
      }
      try {
        JsBarcode(svg, produto.codigo, {
          format: bcFormat,
          width: 2,
          height: 60,
          displayValue: true,
          margin: 4,
          fontSize: 14,
          background: "#ffffff",
          lineColor: "#000000",
        });
        console.info("[ETIQUETA_BARCODE]", produto.codigo, bcFormat);
      } catch (e) {
        console.error("[ETIQUETA_BARCODE] falha", e);
      }
    }, 50);
    return () => window.clearTimeout(id);
  }, [open, produto?.codigo, bcFormat]);

  function renderEtiquetaHtml(): string {
    if (!produto?.codigo) return "";
    const wrapper = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    JsBarcode(wrapper, produto.codigo, {
      format: bcFormat,
      width: 2,
      height: 50,
      displayValue: true,
      margin: 2,
      fontSize: 12,
      background: "#ffffff",
      lineColor: "#000000",
    });
    const svgString = new XMLSerializer().serializeToString(wrapper);
    const f = FORMATOS[formato];
    const isFolha = formato === "a4-grade";
    const w = `${f.wMm}mm`;
    const h = `${f.hMm}mm`;

    const itemHtml = `
      <div class="etq">
        ${
          mostrarNome
            ? `<div class="nome">${escapeHtml(produto.nome)}</div>`
            : ""
        }
        <div class="bc">${svgString}</div>
        ${
          mostrarPreco && produto.preco != null
            ? `<div class="preco">R$ ${Number(produto.preco)
                .toFixed(2)
                .replace(".", ",")}</div>`
            : ""
        }
      </div>
    `;
    const itens = Array.from({ length: copias }, () => itemHtml).join("");

    return `<!doctype html>
<html><head><meta charset="utf-8"><title>Etiqueta</title>
<style>
  @page { size: ${w} ${h}; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; font-family: ui-sans-serif, system-ui, sans-serif; color: #000; background: #fff; }
  .etq {
    width: ${isFolha ? "50mm" : w};
    height: ${isFolha ? "30mm" : h};
    padding: 1mm 2mm;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    page-break-inside: avoid; break-inside: avoid;
    ${isFolha ? "border: 1px dashed #ccc; margin: 1mm;" : ""}
  }
  .nome { font-size: 9pt; font-weight: 600; text-align: center; line-height: 1.1; max-height: 22%; overflow: hidden; }
  .bc { display: flex; justify-content: center; max-width: 100%; }
  .bc svg { max-width: 100%; height: auto; }
  .preco { font-size: 11pt; font-weight: 700; }
  ${isFolha ? "body { display: flex; flex-wrap: wrap; align-content: flex-start; padding: 5mm; gap: 0; }" : ""}
</style></head>
<body>${itens}</body></html>`;
  }

  /** Imprime via iframe oculto (não usa window.open, não é bloqueado). */
  function imprimirViaIframe(html: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const iframe = document.createElement("iframe");
        iframe.style.position = "fixed";
        iframe.style.right = "0";
        iframe.style.bottom = "0";
        iframe.style.width = "0";
        iframe.style.height = "0";
        iframe.style.border = "0";
        iframe.setAttribute("aria-hidden", "true");
        document.body.appendChild(iframe);
        const doc = iframe.contentDocument;
        if (!doc) {
          document.body.removeChild(iframe);
          resolve(false);
          return;
        }
        doc.open();
        doc.write(html);
        doc.close();
        const trigger = () => {
          try {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
            resolve(true);
          } catch (e) {
            console.error("[ETIQUETA_PRINT_ERROR] iframe", e);
            resolve(false);
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
          setTimeout(trigger, 600);
        }
      } catch (e) {
        console.error("[ETIQUETA_PRINT_ERROR] iframe setup", e);
        resolve(false);
      }
    });
  }

  /** Gera PDF da etiqueta (jsPDF) no tamanho real. */
  function gerarPdfEtiqueta(): jsPDF {
    if (!produto?.codigo) throw new Error("Produto sem código.");
    const f = FORMATOS[formato];
    const isFolha = formato === "a4-grade";
    const pageW = f.wMm;
    const pageH = f.hMm;

    // Renderiza barcode em canvas para embutir como imagem no PDF
    const canvas = document.createElement("canvas");
    JsBarcode(canvas, produto.codigo, {
      format: bcFormat,
      width: 2,
      height: 50,
      displayValue: true,
      margin: 2,
      fontSize: 14,
      background: "#ffffff",
      lineColor: "#000000",
    });
    const dataUrl = canvas.toDataURL("image/png");

    const doc = new jsPDF({
      unit: "mm",
      format: [pageW, pageH],
      orientation: pageW > pageH ? "landscape" : "portrait",
    });

    const drawOne = (offsetX: number, offsetY: number, w: number, h: number) => {
      let y = offsetY + 2;
      if (mostrarNome) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        const nome = produto.nome.length > 30 ? produto.nome.slice(0, 30) : produto.nome;
        doc.text(nome, offsetX + w / 2, y + 2, { align: "center" });
        y += 4;
      }
      // Barcode ocupa o miolo
      const bcW = Math.min(w - 2, w * 0.9);
      const bcH = Math.max(8, h - (mostrarNome ? 5 : 0) - (mostrarPreco ? 5 : 0) - 4);
      doc.addImage(
        dataUrl,
        "PNG",
        offsetX + (w - bcW) / 2,
        y,
        bcW,
        bcH,
      );
      y += bcH + 1;
      if (mostrarPreco && produto.preco != null) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text(
          `R$ ${Number(produto.preco).toFixed(2).replace(".", ",")}`,
          offsetX + w / 2,
          y + 2,
          { align: "center" },
        );
      }
    };

    if (isFolha) {
      // Grade 50x30 em A4
      const itemW = 50;
      const itemH = 30;
      const cols = Math.floor((pageW - 10) / itemW);
      const rows = Math.floor((pageH - 10) / itemH);
      let count = 0;
      for (let r = 0; r < rows && count < copias; r++) {
        for (let c = 0; c < cols && count < copias; c++) {
          drawOne(5 + c * itemW, 5 + r * itemH, itemW, itemH);
          count++;
        }
      }
    } else {
      for (let i = 0; i < copias; i++) {
        if (i > 0) doc.addPage([pageW, pageH], pageW > pageH ? "landscape" : "portrait");
        drawOne(0, 0, pageW, pageH);
      }
    }
    return doc;
  }

  async function handleImprimir() {
    if (!produto?.codigo) return;
    setPrinting(true);
    setWarning(null);
    console.info("[ETIQUETA_PRINT]", {
      produto: produto.nome,
      formato,
      copias,
      impressora: selectedPrinter,
    });

    try {
      if (isDesktop() && selectedPrinter) {
        // Salva como padrão de etiqueta deste terminal
        setDefaultLabelPrinter(selectedPrinter);
        try {
          const doc = gerarPdfEtiqueta();
          const buf = doc.output("arraybuffer");
          const msg = await printPdfBytes(new Uint8Array(buf), selectedPrinter);
          console.info("[ETIQUETA_PRINT] enviado", msg);
          toast.success(`Etiqueta enviada para "${selectedPrinter}".`);
          onOpenChange(false);
          return;
        } catch (e) {
          const raw = e instanceof Error ? e.message : String(e);
          const friendly = friendlyPrintError(raw);
          console.warn("[ETIQUETA_PRINT_ERROR] PDF direto falhou", raw);
          setWarning(
            `Impressora "${selectedPrinter}" indisponível. ${friendly} Tentando via diálogo de impressão…`,
          );
        }
      }
      // Fallback: iframe.print() — abre diálogo do SO, usuário escolhe impressora
      const html = renderEtiquetaHtml();
      const ok = await imprimirViaIframe(html);
      if (!ok) {
        toast.error("Não foi possível iniciar a impressão. Use 'Salvar PDF' ou 'Baixar PNG'.");
        return;
      }
      onOpenChange(false);
    } finally {
      setPrinting(false);
    }
  }

  async function handleSalvarPdf() {
    if (!produto?.codigo) return;
    try {
      const doc = gerarPdfEtiqueta();
      const fname = `etiqueta-${(produto.sku ?? produto.codigo).replace(/[^a-z0-9_-]/gi, "_")}.pdf`;
      if (isDesktop()) {
        try {
          const dialogMod = (await import(
            /* @vite-ignore */ "@tauri-apps/plugin-dialog"
          )) as typeof import("@tauri-apps/plugin-dialog");
          const fsMod = (await import(
            /* @vite-ignore */ "@tauri-apps/plugin-fs"
          )) as typeof import("@tauri-apps/plugin-fs");
          const path = await dialogMod.save({
            title: "Salvar etiqueta como PDF",
            defaultPath: fname,
            filters: [{ name: "PDF", extensions: ["pdf"] }],
          });
          if (!path) return;
          const buf = doc.output("arraybuffer");
          await fsMod.writeFile(path as string, new Uint8Array(buf));
          toast.success("PDF salvo com sucesso.");
          return;
        } catch (e) {
          console.warn("[ETIQUETA_PRINT_ERROR] salvar PDF nativo", e);
        }
      }
      doc.save(fname);
      toast.success("Download iniciado.");
    } catch (e) {
      console.error("[ETIQUETA_PRINT_ERROR] gerar PDF", e);
      toast.error("Falha ao gerar PDF da etiqueta.");
    }
  }

  function handleBaixarPng() {
    if (!produto?.codigo) return;
    try {
      const canvas = document.createElement("canvas");
      JsBarcode(canvas, produto.codigo, {
        format: bcFormat,
        width: 2,
        height: 80,
        displayValue: true,
        margin: 6,
        fontSize: 16,
        background: "#ffffff",
        lineColor: "#000000",
      });
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `etiqueta-${(produto.sku ?? produto.codigo).replace(/[^a-z0-9_-]/gi, "_")}.png`;
      a.click();
    } catch (e) {
      console.error("[ETIQUETA_PRINT_ERROR] PNG", e);
      toast.error("Falha ao gerar PNG.");
    }
  }

  async function handleTestePrint() {
    if (!isDesktop()) {
      toast.info("Teste de impressão direto só está disponível no desktop.");
      return;
    }
    if (!selectedPrinter) {
      toast.error("Selecione uma impressora.");
      return;
    }
    setPrinting(true);
    try {
      // Etiqueta de teste com dados fictícios
      const canvas = document.createElement("canvas");
      JsBarcode(canvas, "1234567890128", {
        format: "EAN13",
        width: 2,
        height: 50,
        displayValue: true,
        margin: 2,
        fontSize: 14,
        background: "#ffffff",
        lineColor: "#000000",
      });
      const dataUrl = canvas.toDataURL("image/png");
      const f = FORMATOS[formato === "a4-grade" ? "50x30" : formato];
      const doc = new jsPDF({
        unit: "mm",
        format: [f.wMm, f.hMm],
        orientation: f.wMm > f.hMm ? "landscape" : "portrait",
      });
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("TESTE ETIQUETA", f.wMm / 2, 4, { align: "center" });
      doc.addImage(dataUrl, "PNG", 2, 6, f.wMm - 4, f.hMm - 14);
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.text(new Date().toLocaleString("pt-BR"), f.wMm / 2, f.hMm - 4, {
        align: "center",
      });
      const buf = doc.output("arraybuffer");
      const msg = await printPdfBytes(new Uint8Array(buf), selectedPrinter);
      console.info("[ETIQUETA_PRINT] teste ok", msg);
      toast.success(`Teste enviado para "${selectedPrinter}".`);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      console.error("[ETIQUETA_PRINT_ERROR] teste", raw);
      toast.error(friendlyPrintError(raw));
    } finally {
      setPrinting(false);
    }
  }

  const f = FORMATOS[formato];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
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
            {/* Prévia da etiqueta */}
            <div className="rounded-md border border-border bg-white p-3">
              <div
                className="mx-auto flex flex-col items-center justify-center gap-1 text-black"
                style={{
                  width: `${Math.min(f.wMm * 3, 280)}px`,
                  minHeight: `${Math.min(f.hMm * 3, 180)}px`,
                  padding: "6px",
                }}
              >
                {mostrarNome && (
                  <div
                    className="w-full truncate text-center font-semibold leading-tight"
                    style={{ fontSize: "11px" }}
                  >
                    {produto.nome}
                  </div>
                )}
                <svg ref={previewRef} />
                {mostrarPreco && produto.preco != null && (
                  <div className="font-bold" style={{ fontSize: "14px" }}>
                    R$ {Number(produto.preco).toFixed(2).replace(".", ",")}
                  </div>
                )}
              </div>
              <p className="mt-2 text-center text-[10px] text-muted-foreground">
                Prévia — tamanho real {f.wMm}×{f.hMm} mm
              </p>
            </div>

            {warning && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{warning}</span>
              </div>
            )}

            {/* Impressora (desktop) */}
            {isDesktop() && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Impressora de etiqueta</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => void carregarImpressoras()}
                    disabled={loadingPrinters}
                  >
                    {loadingPrinters ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3 w-3" />
                    )}
                  </Button>
                </div>
                <Select
                  value={selectedPrinter ?? undefined}
                  onValueChange={(v) => setSelectedPrinter(v)}
                  disabled={loadingPrinters || printers.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        loadingPrinters
                          ? "Carregando..."
                          : printers.length === 0
                            ? "Nenhuma impressora encontrada"
                            : "Selecione a impressora"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {printers.map((p) => (
                      <SelectItem key={p.name} value={p.name}>
                        <span className="flex items-center gap-2">
                          {p.name}
                          {p.is_default && (
                            <Badge variant="secondary" className="text-[10px]">
                              padrão SO
                            </Badge>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  Será salva como padrão de etiquetas deste terminal.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Formato</Label>
                <Select value={formato} onValueChange={(v) => setFormato(v as FormatoEtiqueta)}>
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
            </div>
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleBaixarPng}
              disabled={!produto?.codigo}
              className="gap-1.5"
            >
              <Download className="h-3.5 w-3.5" /> PNG
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleSalvarPdf()}
              disabled={!produto?.codigo}
              className="gap-1.5"
            >
              <FileText className="h-3.5 w-3.5" /> PDF
            </Button>
            {isDesktop() && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleTestePrint()}
                disabled={!selectedPrinter || printing}
                className="gap-1.5"
              >
                Teste
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
            <Button
              onClick={() => void handleImprimir()}
              disabled={!produto?.codigo || printing}
              className="gap-1.5"
            >
              {printing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Printer className="h-4 w-4" />
              )}
              Imprimir
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
