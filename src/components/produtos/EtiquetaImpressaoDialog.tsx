import { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { Printer } from "lucide-react";
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
import { validarEan13 } from "@/lib/barcode";

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

const FORMATOS: Record<FormatoEtiqueta, { label: string; w: string; h: string }> = {
  "50x30": { label: "Etiqueta 50×30 mm", w: "50mm", h: "30mm" },
  "60x40": { label: "Etiqueta 60×40 mm", w: "60mm", h: "40mm" },
  "80x40": { label: "Etiqueta 80×40 mm", w: "80mm", h: "40mm" },
  "a4-grade": { label: "Folha A4 (grade)", w: "210mm", h: "297mm" },
};

/**
 * Dialog para configurar e imprimir etiqueta de código de barras.
 * Usa window.print() em uma janela isolada com CSS @page para o tamanho escolhido.
 */
export function EtiquetaImpressaoDialog({
  open,
  onOpenChange,
  produto,
}: EtiquetaImpressaoDialogProps) {
  const [formato, setFormato] = useState<FormatoEtiqueta>("50x30");
  const [copias, setCopias] = useState(1);
  const [mostrarPreco, setMostrarPreco] = useState(true);
  const [mostrarNome, setMostrarNome] = useState(true);
  const previewRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!open || !produto?.codigo || !previewRef.current) return;
    const fmt = validarEan13(produto.codigo) ? "EAN13" : "CODE128";
    try {
      JsBarcode(previewRef.current, produto.codigo, {
        format: fmt,
        width: 2,
        height: 50,
        displayValue: true,
        margin: 2,
        fontSize: 12,
        background: "#ffffff",
      });
    } catch {/* ignora */}
  }, [open, produto?.codigo]);

  function handlePrint() {
    if (!produto?.codigo) return;
    const fmt = validarEan13(produto.codigo) ? "EAN13" : "CODE128";
    const tmp = document.createElement("svg");
    // Gera o SVG inline a partir de um wrapper temporário
    const wrapper = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    JsBarcode(wrapper, produto.codigo, {
      format: fmt,
      width: 2,
      height: 50,
      displayValue: true,
      margin: 2,
      fontSize: 12,
      background: "#ffffff",
    });
    tmp.appendChild(wrapper);
    const svgString = new XMLSerializer().serializeToString(wrapper);

    const f = FORMATOS[formato];
    const isFolha = formato === "a4-grade";
    const itens = Array.from({ length: copias }, () => 1);

    const itemHtml = `
      <div class="etq">
        ${mostrarNome ? `<div class="nome">${escapeHtml(produto.nome)}</div>` : ""}
        <div class="bc">${svgString}</div>
        ${mostrarPreco && produto.preco != null
          ? `<div class="preco">R$ ${Number(produto.preco).toFixed(2).replace(".", ",")}</div>`
          : ""}
      </div>
    `;

    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Etiqueta — ${escapeHtml(produto.nome)}</title>
<style>
  @page { size: ${f.w} ${f.h}; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; font-family: ui-sans-serif, system-ui, sans-serif; color: #000; background: #fff; }
  .etq {
    width: ${isFolha ? "50mm" : f.w};
    height: ${isFolha ? "30mm" : f.h};
    padding: 1mm 2mm;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    page-break-inside: avoid; break-inside: avoid;
    ${isFolha ? "border: 1px dashed #ccc; margin: 1mm;" : ""}
  }
  .nome { font-size: 9pt; font-weight: 600; text-align: center; line-height: 1.1; max-height: 22%; overflow: hidden; }
  .bc { display: flex; justify-content: center; max-width: 100%; }
  .bc svg { max-width: 100%; height: auto; }
  .preco { font-size: 11pt; font-weight: 700; }
  ${isFolha ? `
    body { display: flex; flex-wrap: wrap; align-content: flex-start; padding: 5mm; gap: 0; }
  ` : ""}
  @media print {
    .etq { ${isFolha ? "border: none;" : ""} }
  }
</style></head>
<body>
  ${itens.map(() => itemHtml).join("")}
  <script>
    window.addEventListener('load', () => { setTimeout(() => { window.print(); }, 200); });
  </script>
</body></html>`;

    const w = window.open("", "_blank", "width=400,height=600");
    if (!w) {
      alert("Não foi possível abrir a janela de impressão. Verifique o bloqueador de pop-ups.");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    void tmp; // descarta
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" /> Imprimir etiqueta
          </DialogTitle>
          <DialogDescription>
            {produto?.nome ?? ""}
          </DialogDescription>
        </DialogHeader>

        {!produto?.codigo ? (
          <p className="text-sm text-muted-foreground">
            Este produto ainda não tem código de barras. Gere ou informe um código primeiro.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-center rounded-md border border-border bg-white p-3">
              <svg ref={previewRef} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Formato</Label>
                <Select value={formato} onValueChange={(v) => setFormato(v as FormatoEtiqueta)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(FORMATOS).map(([k, f]) => (
                      <SelectItem key={k} value={k}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Cópias</Label>
                <Input type="number" min={1} max={500}
                  value={copias}
                  onChange={(e) => setCopias(Math.max(1, Math.min(500, Number(e.target.value) || 1)))} />
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={mostrarNome}
                  onCheckedChange={(v) => setMostrarNome(Boolean(v))} />
                Incluir nome do produto
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={mostrarPreco}
                  onCheckedChange={(v) => setMostrarPreco(Boolean(v))} />
                Incluir preço
                {produto.preco == null && (
                  <span className="text-xs text-muted-foreground">(produto sem preço)</span>
                )}
              </label>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          <Button onClick={handlePrint} disabled={!produto?.codigo} className="gap-1.5">
            <Printer className="h-4 w-4" /> Imprimir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    c === "&" ? "&amp;" :
    c === "<" ? "&lt;" :
    c === ">" ? "&gt;" :
    c === '"' ? "&quot;" : "&#39;"
  ));
}
