import { useState } from "react";
import { Loader2, ShoppingCart, Trash2, Crown, Puzzle, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useCart } from "./CartContext";
import { CobrancaPixDialog, type CobrancaResult } from "./CobrancaPixDialog";
import { useCobrancaPendente } from "@/hooks/useCobrancaPendente";

const fmtBRL = (n: number) =>
  Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function CartDrawer() {
  const cart = useCart();
  const [loading, setLoading] = useState(false);
  const [cobranca, setCobranca] = useState<CobrancaResult | null>(null);

  const planos = cart.items.filter((i) => i.kind === "plano");
  const modulos = cart.items.filter((i) => i.kind === "modulo");

  async function checkout() {
    if (cart.items.length === 0) return;
    setLoading(true);
    try {
      // 1) Cria/reutiliza pagamento consolidado
      const { data: pagamentoId, error } = await (supabase.rpc as any)(
        "solicitar_carrinho",
        {
          _planos: planos.map((p) => p.id),
          _modulos: modulos.map((m) => m.id),
        },
      );
      if (error) throw error;

      // 2) Verifica se cobrança automática Asaas está habilitada
      const { data: cfg } = await supabase
        .from("config_comercial")
        .select("asaas_enabled")
        .maybeSingle();

      if (!cfg?.asaas_enabled) {
        toast.success(
          "Solicitação registrada! Aguarde a confirmação do pagamento pelo suporte.",
        );
        cart.clear();
        cart.setOpen(false);
        return;
      }

      // 3) Cria cobrança Pix no Asaas (idempotente do lado da edge)
      const { data: cob, error: cobErr } = await supabase.functions.invoke(
        "asaas-criar-cobranca",
        { body: { pagamento_id: pagamentoId, billing_type: "PIX" } },
      );
      if (cobErr) throw new Error(cobErr.message ?? "Falha ao gerar Pix");

      setCobranca({
        pagamento_id: pagamentoId as string,
        asaas_payment_id: (cob as any).asaas_payment_id,
        invoice_url: (cob as any).invoice_url,
        pix_qrcode: (cob as any).pix_qrcode,
        pix_copia_cola: (cob as any).pix_copia_cola,
        due_date: (cob as any).due_date,
      });
      cart.clear();
      cart.setOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Falha no checkout");
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
                <p className="text-xs">
                  Selecione planos ou módulos para adicionar.
                </p>
              </div>
            ) : (
              <>
                {planos.length > 0 && (
                  <Section title="Planos" icon={<Crown className="h-4 w-4" />}>
                    {planos.map((i) => (
                      <Row key={`p-${i.id}`} item={i} />
                    ))}
                  </Section>
                )}
                {modulos.length > 0 && (
                  <Section title="Módulos" icon={<Puzzle className="h-4 w-4" />}>
                    {modulos.map((i) => (
                      <Row key={`m-${i.id}`} item={i} />
                    ))}
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
                <span className="text-2xl font-bold tracking-tight">
                  {fmtBRL(cart.total)}
                </span>
              </div>
            </>
          )}

          <SheetFooter className="gap-2 sm:flex-col">
            <Button
              className="w-full"
              onClick={checkout}
              disabled={loading || cart.items.length === 0}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Gerar Pix consolidado
            </Button>
            {cart.items.length > 0 && (
              <Button
                variant="ghost"
                className="w-full"
                onClick={cart.clear}
                disabled={loading}
              >
                Esvaziar carrinho
              </Button>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <CobrancaPixDialog
        open={!!cobranca}
        onOpenChange={(v) => !v && setCobranca(null)}
        cobranca={cobranca}
      />
    </>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        {title}
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
        <Badge variant="secondary" className="mt-1 text-xs capitalize">
          {item.kind}
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">{fmtBRL(item.valor)}</span>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => cart.remove(item.kind, item.id)}
          aria-label="Remover do carrinho"
        >
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
      <Button
        className="pointer-events-auto h-12 gap-2 rounded-full px-5 shadow-lg shadow-primary/30"
        onClick={() => cart.setOpen(true)}
      >
        <ShoppingCart className="h-4 w-4" />
        Ver carrinho
        <Badge className="ml-1 bg-background text-foreground hover:bg-background">
          {cart.count}
        </Badge>
      </Button>
    </div>
  );
}
