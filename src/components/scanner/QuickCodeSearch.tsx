import { useState, useEffect, useRef } from "react";
import { Search, ScanLine, Loader2, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScannerDialog } from "./ScannerDialog";
import { buscarProdutoPorCodigo, type ProdutoBuscaResult } from "@/hooks/useProdutoCodigo";
import { useScanner } from "@/hooks/useScanner";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface QuickCodeSearchProps {
  /** Chamado quando produto é encontrado */
  onFound?: (produto: ProdutoBuscaResult) => void;
  /** Chamado quando código não está cadastrado (oferece criar) */
  onNotFound?: (codigo: string) => void;
  /** Habilita captura global de scanner físico USB */
  enableUsbScanner?: boolean;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

/**
 * Caixa de busca rápida por código (manual, scanner USB ou câmera).
 * Mostra resultado inline com nome, SKU, categoria e estoque atual.
 */
export function QuickCodeSearch({
  onFound,
  onNotFound,
  enableUsbScanner = true,
  placeholder = "Escaneie ou digite o código...",
  className,
  autoFocus,
}: QuickCodeSearchProps) {
  const [code, setCode] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<
    | { kind: "found"; produto: ProdutoBuscaResult }
    | { kind: "not-found"; codigo: string }
    | null
  >(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  async function search(value: string) {
    const v = value.trim();
    if (!v) return;
    setLoading(true);
    try {
      const found = await buscarProdutoPorCodigo(v);
      if (found) {
        setResult({ kind: "found", produto: found });
        onFound?.(found);
      } else {
        setResult({ kind: "not-found", codigo: v });
        onNotFound?.(v);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Scanner USB → preenche o input e dispara busca automaticamente
  useScanner((scanned) => {
    setCode(scanned);
    search(scanned);
  }, { enabled: enableUsbScanner });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    search(code);
  }

  return (
    <div className={cn("space-y-3", className)}>
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={placeholder}
            className="pl-9 font-mono"
          />
          {loading && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
        <Button type="button" variant="outline" size="icon" onClick={() => setScannerOpen(true)}
          title="Abrir câmera">
          <ScanLine className="h-4 w-4" />
        </Button>
        <Button type="submit" disabled={!code.trim() || loading}>
          Buscar
        </Button>
      </form>

      {result?.kind === "found" && (
        <Card className="border-success/40 bg-success/5 p-3">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-success/15 text-success">
              <Package className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium leading-tight">{result.produto.nome}</p>
              <p className="text-xs text-muted-foreground">
                <span className="font-mono">{result.produto.sku}</span>
                {result.produto.categoria_nome && ` · ${result.produto.categoria_nome}`}
                {` · ${result.produto.unidade}`}
              </p>
              <p className="mt-1 text-xs">
                <span className="font-medium">Estoque atual:</span>{" "}
                <span className="tabular-nums">{result.produto.saldo_estoque}</span>
                <span className="ml-3 text-muted-foreground">via {fonteLabel(result.produto.fonte)}</span>
              </p>
            </div>
          </div>
        </Card>
      )}

      {result?.kind === "not-found" && (
        <Card className="border-warning/40 bg-warning/5 p-3 text-sm">
          <p>
            Código <span className="font-mono">{result.codigo}</span> não encontrado.
            {onNotFound && " Você pode cadastrar um novo produto com este código."}
          </p>
        </Card>
      )}

      <ScannerDialog
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        mode="any"
        onResult={(scanned) => {
          setCode(scanned);
          search(scanned);
        }}
      />
    </div>
  );
}

function fonteLabel(f: string) {
  switch (f) {
    case "codigo_barras": return "código de barras";
    case "qr_code":       return "QR Code";
    case "sku":           return "SKU";
    case "interno":       return "código interno";
    case "alternativo":   return "código alternativo";
    default: return f;
  }
}
