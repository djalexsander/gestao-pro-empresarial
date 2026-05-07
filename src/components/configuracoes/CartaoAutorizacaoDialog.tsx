import { useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, FileDown } from "lucide-react";
import QRCode from "qrcode";
import JsBarcode from "jsbarcode";
import jsPDF from "jspdf";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  codigo: string;
  label: string;
  empresaNome: string;
}

export function CartaoAutorizacaoDialog({ open, onOpenChange, codigo, label, empresaNome }: Props) {
  const qrRef = useRef<HTMLCanvasElement>(null);
  const barcodeRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!open || !codigo) return;
    const id = requestAnimationFrame(() => {
      if (qrRef.current) {
        QRCode.toCanvas(qrRef.current, codigo, {
          width: 160,
          margin: 1,
          color: { dark: "#000000", light: "#ffffff" },
        }).catch(() => {});
      }
      if (barcodeRef.current) {
        try {
          JsBarcode(barcodeRef.current, codigo, {
            format: "CODE128",
            width: 2,
            height: 60,
            fontSize: 12,
            margin: 4,
            background: "#ffffff",
            lineColor: "#000000",
            displayValue: true,
          });
        } catch {/* noop */}
      }
    });
    return () => cancelAnimationFrame(id);
  }, [open, codigo]);

  function imprimir() {
    if (!qrRef.current || !barcodeRef.current) return;
    const qrData = qrRef.current.toDataURL("image/png");
    const svg = new XMLSerializer().serializeToString(barcodeRef.current);
    const barcodeData = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
    const w = window.open("", "_blank", "width=420,height=600");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>${label}</title>
<style>
  @page { size: 85mm 55mm; margin: 0; }
  body { margin:0; font-family: system-ui, sans-serif; }
  .card { width:85mm; height:55mm; padding:4mm; box-sizing:border-box; display:flex; flex-direction:column; align-items:center; justify-content:space-between; }
  .title { font-size:11pt; font-weight:700; text-align:center; }
  .empresa { font-size:8pt; color:#444; text-align:center; }
  .row { display:flex; gap:6px; align-items:center; justify-content:center; width:100%; }
  .row img.qr { width:70px; height:70px; }
  .row img.bc { max-width:130px; height:50px; }
  .foot { font-size:6.5pt; color:#666; text-align:center; }
</style></head><body>
  <div class="card">
    <div>
      <div class="title">${label || "Cartão Gerente"}</div>
      <div class="empresa">${empresaNome || ""}</div>
    </div>
    <div class="row">
      <img class="qr" src="${qrData}" />
      <img class="bc" src="${barcodeData}" />
    </div>
    <div class="foot">Uso exclusivo para autorização gerencial</div>
  </div>
  <script>window.onload=()=>{setTimeout(()=>{window.print();window.close();},250);}</script>
</body></html>`);
    w.document.close();
  }

  function exportarPDF() {
    if (!qrRef.current || !barcodeRef.current) return;
    const qrData = qrRef.current.toDataURL("image/png");
    const svg = new XMLSerializer().serializeToString(barcodeRef.current);
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: [85, 55] });
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.text(label || "Cartão Gerente", 42.5, 7, { align: "center" });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(80);
    pdf.text(empresaNome || "", 42.5, 12, { align: "center" });
    pdf.addImage(qrData, "PNG", 6, 17, 25, 25);
    // Convert SVG barcode to canvas
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 600; canvas.height = 200;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const bcData = canvas.toDataURL("image/png");
        pdf.addImage(bcData, "PNG", 34, 20, 46, 18);
        pdf.setFontSize(6.5);
        pdf.setTextColor(100);
        pdf.text("Uso exclusivo para autorização gerencial", 42.5, 50, { align: "center" });
        pdf.save(`${(label || "cartao-gerente").replace(/\s+/g, "-").toLowerCase()}.pdf`);
      }
    };
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cartão de autorização</DialogTitle>
        </DialogHeader>
        <div className="rounded-lg border-2 border-dashed border-border bg-white p-4 text-slate-900">
          <div className="text-center">
            <p className="text-base font-bold">{label || "Cartão Gerente"}</p>
            <p className="text-xs text-slate-600">{empresaNome}</p>
          </div>
          <div className="mt-3 flex flex-col items-center justify-center gap-3">
            <canvas ref={qrRef} className="bg-white" />
            <svg ref={barcodeRef} className="bg-white max-w-full" />
            <p className="font-mono text-[11px] tracking-widest text-slate-700 break-all text-center">
              {codigo}
            </p>
          </div>
          <p className="mt-2 text-center text-[10px] uppercase tracking-wide text-slate-500">
            Uso exclusivo para autorização gerencial
          </p>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Guarde este cartão em local seguro. Após salvar, o código não poderá ser visualizado novamente — apenas regerado.
        </p>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          <Button variant="outline" onClick={exportarPDF}><FileDown className="mr-2 h-4 w-4" />Exportar PDF</Button>
          <Button onClick={imprimir}><Printer className="mr-2 h-4 w-4" />Imprimir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
