import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Package, Boxes, ShoppingCart } from "lucide-react";
import { lazy, Suspense, type ComponentType } from "react";
import { Loader2 } from "lucide-react";

export type PdvQuickViewKey = "produtos" | "estoque" | "compras";

// Lazy para não inflar o bundle inicial do PDV
const ProductsPage = lazy(() =>
  import("@/routes/produtos").then((m) => ({ default: m.ProductsPage })),
);
const StockPage = lazy(() =>
  import("@/routes/estoque").then((m) => ({ default: m.StockPage })),
);
const PurchasesPage = lazy(() =>
  import("@/routes/compras").then((m) => ({ default: m.PurchasesPage })),
);

const VIEWS: Record<
  PdvQuickViewKey,
  { title: string; icon: typeof Package; Component: ComponentType }
> = {
  produtos: { title: "Produtos", icon: Package, Component: ProductsPage },
  estoque: { title: "Estoque", icon: Boxes, Component: StockPage },
  compras: { title: "Compras", icon: ShoppingCart, Component: PurchasesPage },
};

interface Props {
  view: PdvQuickViewKey | null;
  onClose: () => void;
}

/**
 * Modal "quase fullscreen" usado no PDV para acessar Produtos, Estoque e
 * Compras sem sair da tela de venda. O PDV continua montado por trás —
 * apenas escondido visualmente — então a venda em andamento (itens, cliente,
 * formas de pagamento) é preservada integralmente.
 */
export function PdvQuickViewDialog({ view, onClose }: Props) {
  const config = view ? VIEWS[view] : null;
  const Icon = config?.icon;
  const Component = config?.Component;

  return (
    <Dialog open={!!view} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="flex h-[95vh] w-[98vw] max-w-[98vw] flex-col gap-0 overflow-hidden p-0 sm:rounded-lg"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="flex flex-row items-center justify-between gap-4 border-b border-border bg-muted/30 px-4 py-3 sm:px-6">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            {Icon && <Icon className="h-5 w-5 text-primary" />}
            Acesso rápido — {config?.title ?? ""}
          </DialogTitle>
          <Button size="sm" variant="default" onClick={onClose} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" />
            Voltar ao PDV
          </Button>
        </DialogHeader>

        <div className="flex-1 overflow-auto bg-background px-4 py-4 sm:px-6">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Carregando…
              </div>
            }
          >
            {Component ? <Component /> : null}
          </Suspense>
        </div>
      </DialogContent>
    </Dialog>
  );
}
