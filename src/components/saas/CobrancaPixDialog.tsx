import { useState } from "react";
import { Copy, Check, ExternalLink, QrCode } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export type CobrancaResult = {
  asaas_payment_id: string;
  invoice_url?: string | null;
  pix_qrcode?: string | null;
  pix_copia_cola?: string | null;
  due_date?: string | null;
};

export function CobrancaPixDialog({
  open,
  onOpenChange,
  cobranca,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cobranca: CobrancaResult | null;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async (val: string) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopied(true);
      toast.success("Código Pix copiado");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" /> Pague com Pix
          </DialogTitle>
          <DialogDescription>
            Após a confirmação do pagamento, o plano/módulo é ativado automaticamente.
            {cobranca?.due_date && (
              <span className="ml-1">
                Vencimento: <strong>{cobranca.due_date}</strong>.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {cobranca?.pix_qrcode ? (
          <div className="flex flex-col items-center gap-3">
            <img
              src={`data:image/png;base64,${cobranca.pix_qrcode}`}
              alt="QR Code Pix"
              className="h-56 w-56 rounded-md border"
            />
            <Badge variant="secondary">Aponte a câmera do banco</Badge>
          </div>
        ) : (
          <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            QR Code indisponível no momento. Use o link da fatura abaixo.
          </p>
        )}

        {cobranca?.pix_copia_cola && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Pix copia e cola</label>
            <div className="flex items-center gap-2">
              <Input value={cobranca.pix_copia_cola} readOnly className="font-mono text-xs" />
              <Button size="icon" variant="outline" onClick={() => copy(cobranca.pix_copia_cola!)}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {cobranca?.invoice_url && (
            <Button variant="outline" asChild>
              <a href={cobranca.invoice_url} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Abrir fatura
              </a>
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
