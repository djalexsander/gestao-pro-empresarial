import { forwardRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Barcode, QrCode } from "lucide-react";
import { ScannerDialog, type ScannerMode } from "./ScannerDialog";
import { cn } from "@/lib/utils";

interface CodeInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value: string;
  onChange: (value: string) => void;
  /** Tipo do scanner ao clicar no botão de câmera */
  scannerMode?: ScannerMode;
  /** Mostra botão de câmera */
  showCamera?: boolean;
  /** Tipo: barcode ou qrcode (afeta apenas o ícone do botão) */
  buttonIcon?: "barcode" | "qrcode";
  containerClassName?: string;
}

/**
 * Input com botão integrado de leitura por câmera (e suporte transparente a scanner USB,
 * que digita direto no input e dispara onChange).
 */
export const CodeInput = forwardRef<HTMLInputElement, CodeInputProps>(function CodeInput(
  {
    value,
    onChange,
    scannerMode = "any",
    showCamera = true,
    buttonIcon = "barcode",
    containerClassName,
    className,
    ...rest
  },
  ref,
) {
  const [scannerOpen, setScannerOpen] = useState(false);
  const Icon = buttonIcon === "qrcode" ? QrCode : Barcode;

  return (
    <div className={cn("flex items-center gap-2", containerClassName)}>
      <Input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn("font-mono", className)}
        {...rest}
      />
      {showCamera && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0"
          onClick={() => setScannerOpen(true)}
          title={buttonIcon === "qrcode" ? "Ler QR Code" : "Ler código de barras"}
        >
          <Icon className="h-4 w-4" />
        </Button>
      )}
      <ScannerDialog
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        mode={scannerMode}
        onResult={(code) => {
          onChange(code);
        }}
      />
    </div>
  );
});
