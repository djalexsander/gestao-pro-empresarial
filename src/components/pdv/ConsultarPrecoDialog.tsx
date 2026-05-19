import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Tag, Package, Scale, AlertCircle } from "lucide-react";
import {
  buscarProdutoPorCodigo,
  type ProdutoBuscaResult,
} from "@/hooks/useProdutoCodigo";
import {
  buscarProdutoPorPlu,
  type ProdutoPluResult,
} from "@/hooks/useProdutoPorPlu";
import {
  parseEtiquetaBalanca,
  calcularPesoEValor,
  type BalancaConfig,
} from "@/lib/balanca";

interface ConsultarPrecoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Configuração de balança ativa (opcional) — para interpretar etiquetas. */
  balancaConfig?: BalancaConfig | null;
  /** Callback ao fechar — útil para devolver foco ao input do PDV. */
  onClosed?: () => void;
}

type Resultado =
  | {
      tipo: "produto";
      nome: string;
      codigoLido: string;
      codigoExibido: string;
      preco_venda: number;
      unidade: string;
      saldo_estoque: number | null;
      vendido_por_peso: boolean;
      status: "ativo" | "inativo" | "descontinuado";
      etiqueta?: { quantidade: number; valor_total: number };
    }
  | { tipo: "nao_encontrado"; codigoLido: string }
  | { tipo: "erro"; mensagem: string };

/**
 * Modal de consulta de preço (F6 no PDV).
 *
 * Apenas informativo — nunca altera venda, estoque ou financeiro.
 * Aceita código normal (barras/QR/SKU/interno) e etiqueta de balança.
 */
export function ConsultarPrecoDialog({
  open,
  onOpenChange,
  balancaConfig,
  onClosed,
}: ConsultarPrecoDialogProps) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset ao abrir/fechar
  useEffect(() => {
    if (open) {
      setCode("");
      setResultado(null);
      // foco automático no campo
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    } else {
      onClosed?.();
    }
  }, [open, onClosed]);

  async function handleConsultar() {
    const v = code.trim();
    if (!v) return;
    setBusy(true);
    try {
      // 1) Tenta produto pelo código exato
      const found: ProdutoBuscaResult | null = await buscarProdutoPorCodigo(v);
      if (found) {
        setResultado({
          tipo: "produto",
          nome: found.nome,
          codigoLido: v,
          codigoExibido:
            found.codigo_barras ||
            found.qr_code ||
            found.codigo_interno ||
            found.sku,
          preco_venda: found.preco_venda,
          unidade: found.unidade,
          saldo_estoque: Number.isFinite(found.saldo_estoque)
            ? found.saldo_estoque
            : null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          vendido_por_peso: Boolean((found as any).vendido_por_peso),
          status: found.status,
        });
        return;
      }

      // 2) Tenta interpretar como etiqueta de balança
      if (balancaConfig?.ativo) {
        const parsed = parseEtiquetaBalanca(v, balancaConfig);
        if (parsed.ok) {
          const prod: ProdutoPluResult | null = await buscarProdutoPorPlu(
            parsed.plu,
          );
          if (!prod) {
            setResultado({ tipo: "nao_encontrado", codigoLido: v });
            return;
          }
          const calc = calcularPesoEValor(parsed, prod.preco_venda);
          if ("erro" in calc) {
            setResultado({ tipo: "erro", mensagem: calc.erro });
            return;
          }
          setResultado({
            tipo: "produto",
            nome: prod.nome,
            codigoLido: v,
            codigoExibido: prod.plu || prod.sku,
            preco_venda: prod.preco_venda,
            unidade: "KG",
            saldo_estoque: null,
            vendido_por_peso: true,
            status: prod.status,
            etiqueta: {
              quantidade: calc.quantidade,
              valor_total: calc.valor_total,
            },
          });
          return;
        }
      }

      setResultado({ tipo: "nao_encontrado", codigoLido: v });
    } catch (e) {
      setResultado({ tipo: "erro", mensagem: (e as Error).message });
    } finally {
      setBusy(false);
      // Limpa o campo e mantém foco para próxima consulta
      setCode("");
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleConsultar();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent keyboardNav={false} className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" />
            Consultar preço do produto
          </DialogTitle>
          <DialogDescription>
            Bipe ou digite o código. Esta consulta não adiciona o item à venda
            nem altera o estoque.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="consulta-codigo">Código de barras / QR Code</Label>
            <div className="flex gap-2">
              <Input
                id="consulta-codigo"
                ref={inputRef}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Bipe ou digite o código"
                className="font-mono text-base"
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                type="button"
                onClick={handleConsultar}
                disabled={busy || !code.trim()}
              >
                <Search className="h-4 w-4 mr-1" />
                Consultar
              </Button>
            </div>
          </div>

          {/* Resultado */}
          {resultado?.tipo === "produto" && (
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">
                    Produto
                  </p>
                  <p className="text-base font-semibold leading-tight truncate">
                    {resultado.nome}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">
                    {resultado.codigoExibido}
                  </p>
                </div>
                {resultado.status !== "ativo" && (
                  <Badge variant="destructive" className="shrink-0">
                    {resultado.status}
                  </Badge>
                )}
              </div>

              <div className="rounded-md bg-primary/5 border border-primary/20 p-3">
                <p className="text-xs text-muted-foreground">
                  {resultado.vendido_por_peso
                    ? "Preço por KG"
                    : `Preço (${resultado.unidade})`}
                </p>
                <p className="text-3xl font-bold tabular-nums">
                  R$ {resultado.preco_venda.toFixed(2)}
                </p>
              </div>

              {resultado.etiqueta && (
                <div className="rounded-md bg-muted/40 p-3 text-sm space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase">
                    <Scale className="h-3.5 w-3.5" />
                    Etiqueta da balança
                  </div>
                  <p className="font-mono">
                    {resultado.etiqueta.quantidade.toFixed(3)} KG × R${" "}
                    {resultado.preco_venda.toFixed(2)}/KG
                  </p>
                  <p className="text-lg font-semibold">
                    Total: R$ {resultado.etiqueta.valor_total.toFixed(2)}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-md bg-muted/30 p-2">
                  <p className="text-xs text-muted-foreground">Unidade</p>
                  <p className="font-medium">{resultado.unidade}</p>
                </div>
                <div className="rounded-md bg-muted/30 p-2">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Package className="h-3 w-3" />
                    Estoque
                  </p>
                  <p className="font-medium tabular-nums">
                    {resultado.saldo_estoque == null
                      ? "—"
                      : resultado.vendido_por_peso
                        ? `${resultado.saldo_estoque.toFixed(3)} ${resultado.unidade}`
                        : `${resultado.saldo_estoque} ${resultado.unidade}`}
                  </p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground font-mono break-all">
                Lido: {resultado.codigoLido}
              </p>
            </div>
          )}

          {resultado?.tipo === "nao_encontrado" && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium">Produto não encontrado</p>
                <p className="text-xs text-muted-foreground font-mono mt-0.5 break-all">
                  Código: {resultado.codigoLido}
                </p>
              </div>
            </div>
          )}

          {resultado?.tipo === "erro" && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <p className="text-sm">{resultado.mensagem}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar (Esc)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
