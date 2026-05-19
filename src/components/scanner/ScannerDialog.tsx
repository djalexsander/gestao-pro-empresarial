import { useEffect, useRef, useState, useCallback } from "react";
import {
  BrowserMultiFormatReader,
  type IScannerControls,
} from "@zxing/browser";
import {
  BarcodeFormat,
  DecodeHintType,
  type Result,
} from "@zxing/library";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Camera,
  CameraOff,
  RefreshCcw,
  CheckCircle2,
  Loader2,
  AlertCircle,
  ScanLine,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ScannerMode = "barcode" | "qrcode" | "any";

interface ScannerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: ScannerMode;
  /** Chamado quando o código é lido. Retorne `false` para continuar lendo, `true`/void para fechar. */
  onResult: (code: string) => void | boolean | Promise<void | boolean>;
  title?: string;
  description?: string;
}

const FORMATS_BY_MODE: Record<ScannerMode, BarcodeFormat[]> = {
  qrcode: [BarcodeFormat.QR_CODE],
  barcode: [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.ITF,
    BarcodeFormat.CODABAR,
  ],
  any: [
    BarcodeFormat.QR_CODE,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.ITF,
    BarcodeFormat.CODABAR,
    BarcodeFormat.DATA_MATRIX,
    BarcodeFormat.PDF_417,
  ],
};

export function ScannerDialog({
  open,
  onOpenChange,
  mode = "any",
  onResult,
  title,
  description,
}: ScannerDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<"idle" | "loading" | "scanning" | "success" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);

  const stop = useCallback(() => {
    try {
      controlsRef.current?.stop();
    } catch {
      /* noop */
    }
    controlsRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (!videoRef.current) return;
    setStatus("loading");
    setErrorMsg(null);
    setLastCode(null);

    try {
      // Lista câmeras (chama getUserMedia uma vez para liberar permissão)
      const list = await BrowserMultiFormatReader.listVideoInputDevices();
      setDevices(list);
      const chosen = deviceId ?? list[list.length - 1]?.deviceId; // tenta câmera traseira (última)
      setDeviceId(chosen);

      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, FORMATS_BY_MODE[mode]);
      hints.set(DecodeHintType.TRY_HARDER, true);

      const reader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 120,
        delayBetweenScanSuccess: 800,
      });
      readerRef.current = reader;

      const controls = await reader.decodeFromVideoDevice(
        chosen,
        videoRef.current,
        async (result: Result | undefined) => {
          if (!result) return;
          const text = result.getText();
          setLastCode(text);
          setStatus("success");
          const close = await onResult(text);
          if (close !== false) {
            stop();
            onOpenChange(false);
          }
        },
      );
      controlsRef.current = controls;
      setStatus("scanning");
    } catch (e) {
      const err = e as Error & { name?: string };
      setStatus("error");
      if (err.name === "NotAllowedError") {
        setErrorMsg("Permissão da câmera negada. Habilite o acesso nas configurações do navegador.");
      } else if (err.name === "NotFoundError") {
        setErrorMsg("Nenhuma câmera encontrada neste dispositivo.");
      } else {
        setErrorMsg(err.message ?? "Falha ao iniciar a câmera.");
      }
    }
  }, [deviceId, mode, onResult, onOpenChange, stop]);

  // Inicia automaticamente ao abrir
  useEffect(() => {
    if (open) {
      start();
    } else {
      stop();
      setStatus("idle");
      setLastCode(null);
      setErrorMsg(null);
    }
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const switchCamera = async () => {
    if (devices.length < 2) return;
    const idx = devices.findIndex((d) => d.deviceId === deviceId);
    const next = devices[(idx + 1) % devices.length];
    setDeviceId(next.deviceId);
    stop();
    // Aguarda 1 frame antes de reiniciar com novo deviceId
    setTimeout(() => start(), 50);
  };

  const titleByMode =
    title ??
    (mode === "qrcode" ? "Ler QR Code" : mode === "barcode" ? "Ler código de barras" : "Ler código");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent keyboardNav={false} className="max-w-lg overflow-hidden bg-zinc-950 p-0 text-zinc-100">
        <div className="border-b border-white/10 px-5 py-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-zinc-100">
              <ScanLine className="h-4 w-4 text-primary-glow" />
              {titleByMode}
            </DialogTitle>
            <DialogDescription className="text-zinc-400">
              {description ?? "Aponte a câmera para o código. A leitura acontece automaticamente."}
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Viewport da câmera */}
        <div className="relative aspect-video bg-black">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            muted
            playsInline
            autoPlay
          />

          {/* Overlay guia */}
          {status === "scanning" && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative h-2/3 w-3/4 rounded-lg border-2 border-primary-glow/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
                <div className="absolute left-0 right-0 top-1/2 h-px animate-pulse bg-primary-glow" />
                <div className="absolute -left-px -top-px h-5 w-5 border-l-2 border-t-2 border-primary-glow" />
                <div className="absolute -right-px -top-px h-5 w-5 border-r-2 border-t-2 border-primary-glow" />
                <div className="absolute -bottom-px -left-px h-5 w-5 border-b-2 border-l-2 border-primary-glow" />
                <div className="absolute -bottom-px -right-px h-5 w-5 border-b-2 border-r-2 border-primary-glow" />
              </div>
            </div>
          )}

          {/* Estados */}
          {status === "loading" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-zinc-200">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-sm">Iniciando câmera…</p>
            </div>
          )}

          {status === "success" && lastCode && (
            <div className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-md bg-success/15 px-3 py-2 text-success ring-1 ring-success/30">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <p className="truncate font-mono text-sm">{lastCode}</p>
            </div>
          )}

          {status === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 px-6 text-center text-zinc-100">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/20 text-destructive">
                <AlertCircle className="h-5 w-5" />
              </div>
              <p className="text-sm">{errorMsg}</p>
              <Button size="sm" variant="secondary" onClick={start}>
                Tentar novamente
              </Button>
            </div>
          )}
        </div>

        {/* Status bar */}
        <div className="flex items-center justify-between gap-3 border-t border-white/10 bg-zinc-900/60 px-5 py-2.5 text-xs text-zinc-400">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                status === "scanning" && "animate-pulse bg-success",
                status === "loading" && "bg-warning animate-pulse",
                status === "error" && "bg-destructive",
                status === "idle" && "bg-zinc-600",
                status === "success" && "bg-success",
              )}
            />
            <span>
              {status === "scanning" && "Procurando código…"}
              {status === "loading" && "Carregando câmera…"}
              {status === "success" && "Código lido"}
              {status === "error" && "Erro"}
              {status === "idle" && "Aguardando"}
            </span>
          </div>
          <div className="text-right text-[11px] text-zinc-500">
            {devices.length > 0 &&
              `Câmera ${devices.findIndex((d) => d.deviceId === deviceId) + 1}/${devices.length}`}
          </div>
        </div>

        <DialogFooter className="gap-2 border-t border-white/10 bg-zinc-900/60 p-3">
          {status === "scanning" ? (
            <Button variant="outline" onClick={() => { stop(); setStatus("idle"); }}
              className="border-white/15 bg-transparent text-zinc-100 hover:bg-white/5">
              <CameraOff className="h-4 w-4" /> Parar
            </Button>
          ) : (
            <Button variant="outline" onClick={start}
              className="border-white/15 bg-transparent text-zinc-100 hover:bg-white/5">
              <Camera className="h-4 w-4" /> Iniciar
            </Button>
          )}
          {devices.length > 1 && (
            <Button variant="outline" onClick={switchCamera}
              className="border-white/15 bg-transparent text-zinc-100 hover:bg-white/5">
              <RefreshCcw className="h-4 w-4" /> Trocar câmera
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
