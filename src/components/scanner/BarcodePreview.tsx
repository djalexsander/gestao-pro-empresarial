import { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { validarEan13 } from "@/lib/barcode";

interface BarcodePreviewProps {
  value: string;
  /** Formato: ean13 tenta primeiro; cai para CODE128 se inválido */
  format?: "auto" | "EAN13" | "CODE128";
  width?: number;
  height?: number;
  displayValue?: boolean;
  className?: string;
  showDownload?: boolean;
  filename?: string;
}

/** Renderiza um código de barras (EAN-13 ou CODE128) em SVG. */
export function BarcodePreview({
  value,
  format = "auto",
  width = 2,
  height = 60,
  displayValue = true,
  className,
  showDownload = true,
  filename = "barcode.png",
}: BarcodePreviewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const v = value?.trim();
    if (!v || !svgRef.current) {
      setError(null);
      return;
    }
    let usar: "EAN13" | "CODE128" = "CODE128";
    if (format === "EAN13") usar = "EAN13";
    else if (format === "auto" && validarEan13(v)) usar = "EAN13";

    try {
      JsBarcode(svgRef.current, v, {
        format: usar,
        width,
        height,
        displayValue,
        margin: 4,
        fontSize: 14,
        background: "#ffffff",
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao gerar código");
    }
  }, [value, format, width, height, displayValue]);

  if (!value?.trim()) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground",
          className,
        )}
        style={{ minHeight: height + 20 }}
      >
        Sem código
      </div>
    );
  }

  function handleDownload() {
    if (!svgRef.current) return;
    const svgData = new XMLSerializer().serializeToString(svgRef.current);
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(svgUrl);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = filename;
      a.click();
    };
    img.src = svgUrl;
  }

  return (
    <div className={cn("inline-flex flex-col items-center gap-2", className)}>
      <div className="rounded-md border border-border bg-white p-2">
        <svg ref={svgRef} />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {showDownload && !error && (
        <Button type="button" variant="outline" size="sm" onClick={handleDownload}
          className="h-8 gap-1.5">
          <Download className="h-3.5 w-3.5" /> Baixar PNG
        </Button>
      )}
    </div>
  );
}
