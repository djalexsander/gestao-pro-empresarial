import { useState } from "react";
import { Crown, Loader2, Puzzle, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useCart } from "./CartContext";
import { CobrancaPixDialog, type CobrancaResult } from "./CobrancaPixDialog";
import { useCobrancaPendente } from "@/hooks/useCobrancaPendente";

const fmtBRL = (value: number) =>
  Number(value ?? 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

export function CartDrawer() {
  const cart = useCart();
  const [loading, setLoading] = useState(false);
  const [cobranca, setCobranca] = useState<CobrancaResult | null>(null);
  const { data: pendente, refetch: refetchPendente } = useCobrancaPendente();

  const planos = cart.items.filter((item) => item.kind === "plano");
  const modulos = cart.items.filter((item) => item.kind === "modulo");

  function pendenteCorrespondeAoCarrinho() {
    if (
      !pendente?.asaas_payment_id ||
      !pendente.pix_qrcode ||
      !pendente.pix_copia_cola
    ) {
      return false;
    }
    if (
      pendente.data_vencimento &&
      new Date(`${pendente.data_vencimento}T23:59:59`).getTime() < Date.now()
    ) {
      return false;
    }

    const esperados = cart.items
      .map((item) => `${item.kind}:${item.id}`)
      .sort();
    const existentes = pendente.itens
      .map((item) =>
        item.tipo === "plano"
          ? `plano:${item.plano_id}`
          : `modulo:${item.modulo_id}`,
      )
      .sort();
    return (
      esperados.length === existentes.length &&
      esperados.every((item, index) => item === existentes[index])
    );
  }

  async function checkout() {
    if (cart.items.length === 0) return;
    setLoading(true);
    try {
      const itens = cart.items.map((item) => ({
        tipo: item.kind,
        id: item.id,
        descricao: item.nome,
        valor: item.valor,
      }));
      const valor = cart.total;

      if (pendenteCorrespondeAoCarrinho() && pendente) {
        setCobranca({
          pagamento_id: pendente.pagamento_id,
          asaas_payment_id: pendente.asaas_payment_id!,
          invoice_url: pendente.invoice_url,
          pix_qrcode: pendente.pix_qrcode,
          pix_copia_cola: pendente.pix_copia_cola,
          due_date: pendente.data_vencimento,
          valor: Number(pendente.valor),
          itens,
        });
        cart.clear();
        cart.setOpen(false);
        return;
      }

      const { data: pagamentoId, error } = await (supabase.rpc as any)(
        "solicitar_carrinho",
        {
          _planos: planos.map((item) => item.id),
          _modulos: modulos.map((item) => item.id),
        },
      );
      if (error) throw error;

      const { data: response, error: functionError } =
        await supabase.functions.invoke("asaas-criar-cobranca", {
          body: { pagamento_id: pagamentoId },
        });
      if (functionError) {
        const context = (functionError as { context?: unknown }).context;
        const response =
          context instanceof Response
            ? context
            : (context as { response?: Response } | undefined)?.response;
        let message = functionError.message;
        if (response) {
          try {
            const body = await response.clone().json();
            if (body?.error) message = String(body.error);
          } catch {
            const raw = await response.clone().text();
            if (raw) message = raw;
          }
        }
        throw new Error(message);
      }

      const result = response as Record<string, unknown>;
      const qrCode = result.qr_code ?? result.pix_qrcode;
      if (!result.asaas_payment_id || !result.pix_copia_cola || !qrCode) {
        throw new Error(
          "O Asaas não retornou todos os dados necessários para o pagamento Pix.",
        );
      }

      setCobranca({
        pagamento_id: pagamentoId as string,
        asaas_payment_id: String(result.asaas_payment_id),
        invoice_url: String(result.invoiceUrl ?? result.invoice_url ?? "") || null,
        pix_qrcode: String(qrCode),
        pix_copia_cola: String(result.pix_copia_cola),
        due_date: String(result.vencimento ?? result.due_date ?? "") || null,
        valor,
        itens,
      });
      await refetchPendente();
      cart.clear();
      cart.setOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Falha ao gerar a cobrança Pix.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Sheet open={cart.open} onOpenChange={cart.setOpen}>
        <SheetContent className="flex w-full flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" />
              Carrinho ({cart.count})
            </SheetTitle>
            <SheetDescription>
              Pague todos os itens em uma única cobrança Pix.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto py-4">
            {cart.items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
                <ShoppingCart className="h-10 w-10 opacity-40" />
                <p className="text-sm">Seu carrinho está vazio.</p>
                <p className="text-xs">Selecione planos ou módulos para adicionar.</p>
              </div>
            ) : (
              <>
                {planos.length > 0 && (
                  <Section title="Planos" icon={<Crown className="h-4 w-4" />}>
                    {planos.map((item) => <Row key={`p-${item.id}`} item={item} />)}
                  </Section>
                )}
                {modulos.length > 0 && (
                  <Section title="Módulos" icon={<Puzzle className="h-4 w-4" />}>
                    {modulos.map((item) => <Row key={`m-${item.id}`} item={item} />)}
                  </Section>
                )}
              </>
            )}
          </div>

          {cart.items.length > 0 && (
            <>
              <Separator />
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-muted-foreground">Total</span>
                <span className="text-2xl font-bold tracking-tight">{fmtBRL(cart.total)}</span>
              </div>
            </>
          )}

          <SheetFooter className="gap-2 sm:flex-col">
            <Button className="w-full" onClick={checkout} disabled={loading || cart.items.length === 0}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Gerar Pix consolidado
            </Button>
            {cart.items.length > 0 && (
              <Button variant="ghost" className="w-full" onClick={cart.clear} disabled={loading}>
                Esvaziar carrinho
              </Button>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <CobrancaPixDialog
        open={Boolean(cobranca)}
        onOpenChange={(open) => !open && setCobranca(null)}
        cobranca={cobranca}
      />
    </>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {icon}{title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({ item }: { item: ReturnType<typeof useCart>["items"][number] }) {
  const cart = useCart();
  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{item.nome}</p>
        <Badge variant="secondary" className="mt-1 text-xs capitalize">{item.kind}</Badge>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">{fmtBRL(item.valor)}</span>
        <Button size="icon" variant="ghost" onClick={() => cart.remove(item.kind, item.id)} aria-label="Remover do carrinho">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function CartFloatingButton() {
  const cart = useCart();
  if (cart.count === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 sm:bottom-6">
      <Button className="pointer-events-auto h-12 gap-2 rounded-full px-5 shadow-lg shadow-primary/30" onClick={() => cart.setOpen(true)}>
        <ShoppingCart className="h-4 w-4" />
        Ver carrinho
        <Badge className="ml-1 bg-background text-foreground hover:bg-background">{cart.count}</Badge>
      </Button>
    </div>
  );
}
