import { useEffect, useState } from "react";
import { Check, CheckCircle2, Copy, ExternalLink, Loader2, QrCode, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export type CobrancaResult = {
  pagamento_id?: string;
  asaas_payment_id: string;
  invoice_url?: string | null;
  pix_qrcode?: string | null;
  pix_copia_cola?: string | null;
  due_date?: string | null;
  valor?: number | null;
  itens?: Array<{ tipo: "plano" | "modulo"; id?: string | null; descricao: string; valor: number }>;
};

const fmtBRL = (value: number) => Number(value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
function fmtDate(value?: string | null) {
  if (!value) return "Não informado";
  const date = new Date(value.includes("T") ? value : `${value}T23:59:59`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: value.includes("T") ? "short" : undefined });
}

export function CobrancaPixDialog({ open, onOpenChange, cobranca, autoCloseOnPaid = true, autoCloseDelayMs = 2500 }: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  cobranca: CobrancaResult | null;
  autoCloseOnPaid?: boolean;
  autoCloseDelayMs?: number;
}) {
  const [copied, setCopied] = useState(false);
  const [pago, setPago] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const queryClient = useQueryClient();

  const markPaid = () => {
    setPago(true);
    toast.success("Pagamento confirmado. Seus módulos foram liberados.");
    for (const queryKey of [["minha-assinatura"], ["planos-disponiveis"], ["modulos-disponiveis-cliente"], ["meus-modulos"], ["cobranca-pendente"], ["meus-pagamentos"]]) {
      queryClient.invalidateQueries({ queryKey });
    }
  };

  useEffect(() => {
    if (!open || !cobranca?.pagamento_id) return;
    setPago(false);
    const channel = supabase.channel(`pagamento-${cobranca.pagamento_id}`).on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "pagamentos", filter: `id=eq.${cobranca.pagamento_id}` },
      (payload) => {
        if ((payload.new as { status?: string }).status === "pago") markPaid();
      },
    ).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [open, cobranca?.pagamento_id, queryClient]);

  useEffect(() => {
    if (!pago || !autoCloseOnPaid || !open) return;
    const timer = setTimeout(() => onOpenChange(false), autoCloseDelayMs);
    return () => clearTimeout(timer);
  }, [pago, autoCloseOnPaid, autoCloseDelayMs, open, onOpenChange]);

  async function copyPix() {
    if (!cobranca?.pix_copia_cola) return;
    try {
      await navigator.clipboard.writeText(cobranca.pix_copia_cola);
      setCopied(true);
      toast.success("Código Pix copiado");
      setTimeout(() => setCopied(false), 2000);
    } catch { toast.error("Não foi possível copiar o código Pix."); }
  }

  async function verificarPagamento() {
    if (!cobranca?.pagamento_id) return toast.error("Identificação interna da cobrança indisponível.");
    setVerificando(true);
    try {
      const { data, error } = await supabase.from("pagamentos").select("status").eq("id", cobranca.pagamento_id).maybeSingle();
      if (error) throw error;
      if (data?.status === "pago") markPaid();
      else if (data?.status === "cancelado") toast.error("Esta cobrança foi cancelada.");
      else if (data?.status === "atrasado") toast.error("Esta cobrança está vencida.");
      else toast.info("Pagamento ainda não confirmado pelo Asaas.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível verificar o pagamento.");
    } finally { setVerificando(false); }
  }

  const qrSource = cobranca?.pix_qrcode?.startsWith("data:") ? cobranca.pix_qrcode : `data:image/png;base64,${cobranca?.pix_qrcode ?? ""}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><QrCode className="h-5 w-5" /> Pagamento Pix</DialogTitle>
          <DialogDescription>
            {pago ? "Pagamento confirmado. Seus módulos já estão ativos." : "Conclua o pagamento no aplicativo do seu banco."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-center">
          {pago ? <Badge className="gap-1 bg-emerald-500 text-white"><CheckCircle2 className="h-3.5 w-3.5" />Pagamento confirmado</Badge> : <Badge variant="outline" className="gap-1"><Loader2 className="h-3.5 w-3.5 animate-spin" />Aguardando pagamento</Badge>}
        </div>

        {!pago && (
          <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
            <div className="flex items-center justify-between"><span className="text-sm font-medium">Resumo da contratação</span>{cobranca?.valor != null && <strong>{fmtBRL(cobranca.valor)}</strong>}</div>
            {cobranca?.itens?.map((item, index) => <div key={`${item.tipo}-${item.id ?? index}`} className="flex justify-between gap-3 text-xs text-muted-foreground"><span className="truncate">{item.descricao}</span><span className="shrink-0">{fmtBRL(item.valor)}</span></div>)}
            <div className="flex justify-between border-t pt-2 text-xs"><span>Vencimento</span><strong>{fmtDate(cobranca?.due_date)}</strong></div>
          </div>
        )}

        {!pago && cobranca?.pix_qrcode && <div className="flex flex-col items-center gap-3"><img src={qrSource} alt="QR Code Pix" className="h-56 w-56 rounded-md border" /><Badge variant="secondary">Aponte a câmera do banco</Badge></div>}

        {!pago && cobranca?.pix_copia_cola && <div className="space-y-2"><label className="text-xs font-medium">Código Pix copia e cola</label><Input value={cobranca.pix_copia_cola} readOnly className="font-mono text-xs" /><Button className="w-full" variant="outline" onClick={copyPix}>{copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}{copied ? "Código copiado" : "Copiar código Pix"}</Button></div>}

        <DialogFooter className="gap-2 sm:justify-between">
          {cobranca?.invoice_url && <Button variant="outline" asChild><a href={cobranca.invoice_url} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Abrir fatura</a></Button>}
          {!pago && <Button variant="secondary" onClick={verificarPagamento} disabled={verificando}>{verificando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Verificar pagamento</Button>}
          <Button onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
