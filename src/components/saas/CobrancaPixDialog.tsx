import { useEffect, useState } from "react";
import { Copy, Check, ExternalLink, QrCode, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { realtimeClient } from "@/integrations/data/realtime-client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export type CobrancaResult = {
  /** ID interno do pagamento (tabela `pagamentos`). Necessário para o realtime. */
  pagamento_id?: string;
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
  autoCloseOnPaid = true,
  autoCloseDelayMs = 2500,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cobranca: CobrancaResult | null;
  /** Fecha o diálogo automaticamente após confirmar pagamento. */
  autoCloseOnPaid?: boolean;
  /** Tempo (ms) que a confirmação fica visível antes do fechamento automático. */
  autoCloseDelayMs?: number;
}) {
  const [copied, setCopied] = useState(false);
  const [pago, setPago] = useState(false);
  const qc = useQueryClient();

  // Realtime: escuta mudança do pagamento → quando virar `pago`, atualiza UI
  // e invalida queries para refletir plano/módulo ativo automaticamente.
  useEffect(() => {
    if (!open || !cobranca?.pagamento_id) return;
    setPago(false);

    const stop = realtimeClient.subscribeTable<{ status?: string }>(
      {
        table: "pagamentos",
        event: "UPDATE",
        filter: `id=eq.${cobranca.pagamento_id}`,
      },
      (payload) => {
        const novo = payload.new;
        if (novo?.status === "pago") {
          setPago(true);
          toast.success("Pagamento confirmado! Plano/módulo ativado.");
          qc.invalidateQueries({ queryKey: ["minha-assinatura"] });
          qc.invalidateQueries({ queryKey: ["planos-disponiveis"] });
          qc.invalidateQueries({ queryKey: ["modulos-disponiveis-cliente"] });
          qc.invalidateQueries({ queryKey: ["meus-modulos"] });
          qc.invalidateQueries({ queryKey: ["cobranca-pendente"] });
          qc.invalidateQueries({ queryKey: ["meus-pagamentos"] });
        }
      },
    );

    return () => {
      stop();
    };
  }, [open, cobranca?.pagamento_id, qc]);

  // Fechamento automático após confirmação
  useEffect(() => {
    if (!pago || !autoCloseOnPaid || !open) return;
    const t = setTimeout(() => onOpenChange(false), autoCloseDelayMs);
    return () => clearTimeout(t);
  }, [pago, autoCloseOnPaid, autoCloseDelayMs, open, onOpenChange]);

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
            {pago
              ? "Pagamento confirmado. O plano/módulo já está ativo."
              : "Após a confirmação do pagamento, o plano/módulo é ativado automaticamente."}
            {cobranca?.due_date && !pago && (
              <span className="ml-1">
                Vencimento: <strong>{cobranca.due_date}</strong>.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-center">
          {pago ? (
            <Badge className="gap-1 bg-emerald-500 text-white hover:bg-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Pagamento confirmado
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Aguardando pagamento
            </Badge>
          )}
        </div>

        {!pago && cobranca?.pix_qrcode ? (
          <div className="flex flex-col items-center gap-3">
            <img
              src={`data:image/png;base64,${cobranca.pix_qrcode}`}
              alt="QR Code Pix"
              className="h-56 w-56 rounded-md border"
            />
            <Badge variant="secondary">Aponte a câmera do banco</Badge>
          </div>
        ) : !pago ? (
          <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            QR Code indisponível no momento. Use o link da fatura abaixo.
          </p>
        ) : null}

        {!pago && cobranca?.pix_copia_cola && (
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
