import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface QrPreviewProps {
  value: string;
  size?: number;
  className?: string;
  showDownload?: boolean;
  filename?: string;
}

/** Gera visualização (canvas) de QR Code para o valor informado. */
export function QrPreview({
  value,
  size = 160,
  className,
  showDownload = true,
  filename = "qrcode.png",
}: QrPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = value?.trim();
    if (!trimmed || !canvasRef.current) {
      setError(null);
      return;
    }
    QRCode.toCanvas(
      canvasRef.current,
      trimmed,
      { width: size, margin: 1, errorCorrectionLevel: "M" },
      (err) => {
        setError(err ? "Não foi possível gerar QR Code" : null);
      },
    );
  }, [value, size]);

  if (!value?.trim()) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center rounded-md border border-dashed border-border bg-muted/30 text-xs text-muted-foreground",
          className,
        )}
        style={{ width: size, height: size }}
      >
        Sem valor
      </div>
    );
  }

  function handleDownload() {
    if (!canvasRef.current) return;
    const url = canvasRef.current.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  }

  return (
    <div className={cn("inline-flex flex-col items-center gap-2", className)}>
      <div className="rounded-md border border-border bg-white p-2">
        <canvas ref={canvasRef} />
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
