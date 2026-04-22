import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ScanLine,
  Search,
  Trash2,
  Plus,
  Minus,
  X,
  ShoppingBag,
  User,
  Camera,
  Receipt,
  Loader2,
  Package,
  CheckCircle2,
  Eraser,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScannerDialog } from "@/components/scanner/ScannerDialog";
import { FinalizarVendaDialog } from "@/components/pdv/FinalizarVendaDialog";
import {
  buscarProdutoPorCodigo,
  type ProdutoBuscaResult,
} from "@/hooks/useProdutoCodigo";
import { useScanner } from "@/hooks/useScanner";
import { useProdutos } from "@/hooks/useProdutos";
import { useClientes, type ClienteLite } from "@/hooks/useClientes";
import { useAuth } from "@/components/auth/AuthProvider";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/mock-data";

export const Route = createFileRoute("/pdv")({
  head: () => ({
    meta: [
      { title: "PDV — Nova Venda — Gestão Pro" },
      {
        name: "description",
        content: "Frente de caixa para vendas rápidas com leitura de código de barras.",
      },
    ],
  }),
  component: PDVPage,
});

interface VendaItem {
  key: string; // identificador único na tela (produto + variacao)
  produto_id: string;
  sku: string;
  nome: string;
  unidade: string;
  preco_unitario: number;
  quantidade: number;
  desconto: number; // valor absoluto por linha
}

const DEFAULT_FOCUS_DELAY = 30;

function PDVPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: produtos = [], isLoading: loadingProdutos } = useProdutos();
  const { data: clientes = [] } = useClientes();

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<VendaItem[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState<null | "clear" | "cancel">(
    null,
  );
  const [cliente, setCliente] = useState<ClienteLite | null>(null);
  const [clientePopoverOpen, setClientePopoverOpen] = useState(false);
  const [observacao, setObservacao] = useState("");
  const [lastAddedKey, setLastAddedKey] = useState<string | null>(null);
  const [searchPopoverOpen, setSearchPopoverOpen] = useState(false);
  const [manualQuery, setManualQuery] = useState("");
  const [finalizarOpen, setFinalizarOpen] = useState(false);

  const scanInputRef = useRef<HTMLInputElement>(null);

  // Foco automático no campo de leitura
  useEffect(() => {
    const t = setTimeout(() => scanInputRef.current?.focus(), DEFAULT_FOCUS_DELAY);
    return () => clearTimeout(t);
  }, []);

  // Restaura foco quando abre/fecha popovers/dialogs
  useEffect(() => {
    if (!scannerOpen && !clientePopoverOpen && !searchPopoverOpen && !confirmClear) {
      const t = setTimeout(() => scanInputRef.current?.focus(), DEFAULT_FOCUS_DELAY);
      return () => clearTimeout(t);
    }
  }, [scannerOpen, clientePopoverOpen, searchPopoverOpen, confirmClear]);

  // ============ Totais ============
  const totals = useMemo(() => {
    const subtotal = items.reduce(
      (acc, it) => acc + it.preco_unitario * it.quantidade,
      0,
    );
    const descontoTotal = items.reduce((acc, it) => acc + it.desconto, 0);
    const total = Math.max(0, subtotal - descontoTotal);
    const totalItens = items.reduce((acc, it) => acc + it.quantidade, 0);
    return { subtotal, descontoTotal, total, totalItens };
  }, [items]);

  // ============ Adicionar item ============
  function addItemFromProduto(p: {
    produto_id: string;
    sku: string;
    nome: string;
    unidade: string;
    preco_venda: number;
  }) {
    setItems((prev) => {
      const idx = prev.findIndex((it) => it.produto_id === p.produto_id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantidade: next[idx].quantidade + 1 };
        setLastAddedKey(next[idx].key);
        return next;
      }
      const novo: VendaItem = {
        key: `${p.produto_id}-${Date.now()}`,
        produto_id: p.produto_id,
        sku: p.sku,
        nome: p.nome,
        unidade: p.unidade,
        preco_unitario: Number(p.preco_venda) || 0,
        quantidade: 1,
        desconto: 0,
      };
      setLastAddedKey(novo.key);
      return [novo, ...prev];
    });
  }

  // ============ Buscar por código ============
  async function handleScanCode(value: string) {
    const v = value.trim();
    if (!v) return;
    setBusy(true);
    try {
      const found = await buscarProdutoPorCodigo(v);
      if (found) {
        if (found.status !== "ativo") {
          toast.warning(`Produto "${found.nome}" está ${found.status}.`);
        }
        addItemFromProduto({
          produto_id: found.produto_id,
          sku: found.sku,
          nome: found.nome,
          unidade: found.unidade,
          preco_venda: found.preco_venda,
        });
        toast.success(`+ ${found.nome}`, { duration: 1200 });
      } else {
        toast.error(`Produto não encontrado para "${v}"`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setCode("");
      setTimeout(() => scanInputRef.current?.focus(), DEFAULT_FOCUS_DELAY);
    }
  }

  // Scanner USB global
  useScanner((scanned) => handleScanCode(scanned), { enabled: true });

  function handleSubmitCode(e: React.FormEvent) {
    e.preventDefault();
    handleScanCode(code);
  }

  // ============ Quantidade / desconto / remover ============
  function updateQty(key: string, qty: number) {
    setItems((prev) =>
      prev.map((it) => (it.key === key ? { ...it, quantidade: Math.max(0.001, qty) } : it)),
    );
  }
  function incQty(key: string, delta: number) {
    setItems((prev) =>
      prev.map((it) =>
        it.key === key
          ? { ...it, quantidade: Math.max(0.001, it.quantidade + delta) }
          : it,
      ),
    );
  }
  function updateDesconto(key: string, desc: number) {
    setItems((prev) =>
      prev.map((it) =>
        it.key === key ? { ...it, desconto: Math.max(0, desc) } : it,
      ),
    );
  }
  function removeItem(key: string) {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }

  function clearVenda() {
    setItems([]);
    setObservacao("");
    setLastAddedKey(null);
    setTimeout(() => scanInputRef.current?.focus(), DEFAULT_FOCUS_DELAY);
  }

  function cancelVenda() {
    clearVenda();
    setCliente(null);
    navigate({ to: "/vendas" });
  }

  function finalizarVenda() {
    if (items.length === 0) {
      toast.warning("Adicione ao menos um item à venda.");
      return;
    }
    // Próxima etapa de pagamento será implementada depois.
    toast.success("Venda pronta para finalização — etapa de pagamento em breve.");
  }

  // ============ Busca manual ============
  const filteredProdutos = useMemo(() => {
    const q = manualQuery.trim().toLowerCase();
    if (!q) return produtos.slice(0, 25);
    return produtos
      .filter((p) => {
        return (
          p.nome.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.codigo_barras ?? "").toLowerCase().includes(q) ||
          (p.codigo_interno ?? "").toLowerCase().includes(q)
        );
      })
      .slice(0, 50);
  }, [produtos, manualQuery]);

  // ============ Render ============
  return (
    <div className="flex h-[calc(100vh-7.5rem)] flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <ShoppingBag className="h-5 w-5" />
          </div>
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              PDV — Nova Venda
              <Badge variant="outline" className="text-xs font-normal">
                Frente de caixa
              </Badge>
            </h1>
            <p className="text-xs text-muted-foreground">
              Operador: <span className="font-medium text-foreground">{user?.email ?? "—"}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Popover open={clientePopoverOpen} onOpenChange={setClientePopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <User className="h-4 w-4" />
                {cliente ? cliente.nome : "Cliente: Consumidor"}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
              <Command>
                <CommandInput placeholder="Buscar cliente..." />
                <CommandList>
                  <CommandEmpty>Nenhum cliente.</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      onSelect={() => {
                        setCliente(null);
                        setClientePopoverOpen(false);
                      }}
                    >
                      <X className="h-4 w-4" /> Sem cliente (Consumidor)
                    </CommandItem>
                    {clientes.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={`${c.nome} ${c.documento ?? ""}`}
                        onSelect={() => {
                          setCliente(c);
                          setClientePopoverOpen(false);
                        }}
                      >
                        <User className="h-4 w-4" />
                        <div className="flex flex-col">
                          <span>{c.nome}</span>
                          {c.documento && (
                            <span className="text-xs text-muted-foreground">
                              {c.documento}
                            </span>
                          )}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Body: 2 colunas */}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ============ LADO ESQUERDO ============ */}
        <div className="flex min-h-0 flex-col gap-3">
          {/* Campo de leitura grande */}
          <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-4 shadow-lg">
            <form onSubmit={handleSubmitCode} className="flex items-center gap-2">
              <div className="relative flex-1">
                <ScanLine
                  className={cn(
                    "pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 transition-colors",
                    busy ? "text-primary" : "text-primary/70",
                  )}
                />
                <Input
                  ref={scanInputRef}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Escaneie ou digite o código de barras / QR Code…"
                  className="h-14 border-primary/40 bg-background/60 pl-12 pr-12 font-mono text-lg tracking-wider focus-visible:ring-primary"
                  autoComplete="off"
                  spellCheck={false}
                />
                {busy && (
                  <Loader2 className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-primary" />
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-14 w-14"
                onClick={() => setScannerOpen(true)}
                title="Abrir câmera"
              >
                <Camera className="h-5 w-5" />
              </Button>
              <Button type="submit" size="lg" className="h-14 px-6" disabled={busy || !code.trim()}>
                Adicionar
              </Button>
            </form>

            {/* Busca manual inline */}
            <div className="mt-3 flex items-center gap-2">
              <Popover open={searchPopoverOpen} onOpenChange={setSearchPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
                    <Search className="h-4 w-4" /> Buscar produto manualmente
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[420px] p-0">
                  <Command shouldFilter={false}>
                    <CommandInput
                      value={manualQuery}
                      onValueChange={setManualQuery}
                      placeholder="Nome, SKU, código de barras…"
                    />
                    <CommandList>
                      <CommandEmpty>
                        {loadingProdutos ? "Carregando..." : "Nenhum produto encontrado."}
                      </CommandEmpty>
                      <CommandGroup>
                        {filteredProdutos.map((p) => (
                          <CommandItem
                            key={p.id}
                            value={p.id}
                            onSelect={() => {
                              addItemFromProduto({
                                produto_id: p.id,
                                sku: p.sku,
                                nome: p.nome,
                                unidade: p.unidade,
                                preco_venda: Number(p.preco_venda) || 0,
                              });
                              setSearchPopoverOpen(false);
                              setManualQuery("");
                            }}
                          >
                            <Package className="h-4 w-4" />
                            <div className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate">{p.nome}</span>
                              <span className="font-mono text-xs text-muted-foreground">
                                {p.sku}
                                {p.codigo_barras && ` · ${p.codigo_barras}`}
                              </span>
                            </div>
                            <span className="ml-2 shrink-0 tabular-nums text-xs">
                              {formatBRL(Number(p.preco_venda) || 0)}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              <span className="ml-auto text-xs text-muted-foreground">
                Pressione <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono">Enter</kbd> ou bipe um produto
              </span>
            </div>
          </Card>

          {/* Tabela de itens */}
          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="grid grid-cols-[1fr_120px_140px_140px_44px] items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <span>Produto</span>
              <span className="text-center">Quantidade</span>
              <span className="text-right">Unitário</span>
              <span className="text-right">Subtotal</span>
              <span />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {items.length === 0 ? (
                <EmptyItems />
              ) : (
                <ul>
                  {items.map((it) => {
                    const sub = it.preco_unitario * it.quantidade - it.desconto;
                    return (
                      <li
                        key={it.key}
                        className={cn(
                          "grid grid-cols-[1fr_120px_140px_140px_44px] items-center gap-2 border-b border-border/60 px-4 py-3 transition-colors",
                          lastAddedKey === it.key && "bg-success/10 animate-in fade-in",
                        )}
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{it.nome}</p>
                          <p className="font-mono text-xs text-muted-foreground">
                            {it.sku} · {it.unidade}
                            {it.desconto > 0 && (
                              <span className="ml-2 text-warning">
                                desc. {formatBRL(it.desconto)}
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => incQty(it.key, -1)}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <Input
                            type="number"
                            value={it.quantidade}
                            onChange={(e) => updateQty(it.key, Number(e.target.value))}
                            className="h-7 w-14 px-1 text-center font-mono"
                            min="0.001"
                            step="any"
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => incQty(it.key, 1)}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="text-right tabular-nums">
                          {formatBRL(it.preco_unitario)}
                        </div>
                        <div className="text-right font-semibold tabular-nums">
                          {formatBRL(Math.max(0, sub))}
                        </div>
                        <div className="flex justify-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => removeItem(it.key)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>
        </div>

        {/* ============ LADO DIREITO — RESUMO ============ */}
        <aside className="flex min-h-0 flex-col gap-3">
          <Card className="flex-1 overflow-hidden">
            <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
              <h3 className="text-sm font-semibold">Resumo da venda</h3>
              <Receipt className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="space-y-4 p-4">
              <div className="space-y-2 text-sm">
                <Row label="Itens">
                  <span className="tabular-nums">
                    {items.length} <span className="text-muted-foreground">({totals.totalItens.toFixed(0)} un.)</span>
                  </span>
                </Row>
                <Row label="Subtotal">
                  <span className="tabular-nums">{formatBRL(totals.subtotal)}</span>
                </Row>
                <Row label="Descontos">
                  <span className="tabular-nums text-warning">
                    {totals.descontoTotal > 0 ? `- ${formatBRL(totals.descontoTotal)}` : formatBRL(0)}
                  </span>
                </Row>
              </div>

              <div className="border-t border-border pt-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Total</p>
                <p className="font-mono text-3xl font-bold tabular-nums text-primary">
                  {formatBRL(totals.total)}
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Observação
                </label>
                <Textarea
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  rows={2}
                  placeholder="Ex.: entrega no balcão, troco para R$ 100…"
                  className="resize-none text-sm"
                />
              </div>
            </div>
          </Card>

          {/* Ações */}
          <div className="space-y-2">
            <Button
              size="lg"
              className="h-14 w-full text-base font-semibold"
              onClick={finalizarVenda}
              disabled={items.length === 0}
            >
              <CheckCircle2 className="h-5 w-5" />
              Finalizar venda · {formatBRL(totals.total)}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={() => setConfirmClear("clear")}
                disabled={items.length === 0}
              >
                <Eraser className="h-4 w-4" /> Limpar
              </Button>
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmClear("cancel")}
              >
                <X className="h-4 w-4" /> Cancelar
              </Button>
            </div>
          </div>
        </aside>
      </div>

      {/* Scanner por câmera */}
      <ScannerDialog
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        mode="any"
        onResult={(scanned) => {
          setScannerOpen(false);
          handleScanCode(scanned);
        }}
      />

      {/* Confirmações */}
      <AlertDialog
        open={confirmClear !== null}
        onOpenChange={(open) => !open && setConfirmClear(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmClear === "clear" ? "Limpar venda?" : "Cancelar venda?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmClear === "clear"
                ? "Todos os itens da venda atual serão removidos. Esta ação não pode ser desfeita."
                : "A venda atual será descartada e você voltará para a lista de vendas."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmClear === "clear") clearVenda();
                else cancelVenda();
                setConfirmClear(null);
              }}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}

function EmptyItems() {
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <ScanLine className="h-7 w-7" />
      </div>
      <div>
        <p className="font-medium">Nenhum item na venda</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Bipe um código de barras ou busque um produto para começar.
        </p>
      </div>
    </div>
  );
}
