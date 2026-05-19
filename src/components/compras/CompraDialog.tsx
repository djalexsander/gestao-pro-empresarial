import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, Barcode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useFornecedores } from "@/hooks/useFornecedores";
import { useProdutos } from "@/hooks/useProdutos";
import { useCreateCompra, gerarNumeroCompra, type CompraItemInput } from "@/hooks/useCompras";
import { buscarProdutoPorCodigo } from "@/hooks/useProdutoCodigo";
import { ProdutoSearchSelect } from "@/components/produtos/ProdutoSearchSelect";
import { FornecedorSearchSelect } from "@/components/fornecedores/FornecedorSearchSelect";
import { FormSection } from "@/components/shared/FormSection";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

type LinhaItem = CompraItemInput & { _key: string };

function novoItem(): LinhaItem {
  return {
    _key: crypto.randomUUID(),
    produto_id: "",
    quantidade: 1,
    preco_unitario: 0,
    desconto: 0,
  };
}

const fmtBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function CompraDialog({ open, onOpenChange }: Props) {
  const { data: fornecedores = [] } = useFornecedores();
  const { data: produtos = [] } = useProdutos();
  const create = useCreateCompra();

  const [numero, setNumero] = useState("");
  const [fornecedorId, setFornecedorId] = useState<string>("");
  const [dataEmissao, setDataEmissao] = useState(new Date().toISOString().slice(0, 10));
  const [dataPrevista, setDataPrevista] = useState("");
  const [dataVencimento, setDataVencimento] = useState("");
  const [numeroNf, setNumeroNf] = useState("");
  const [desconto, setDesconto] = useState(0);
  const [frete, setFrete] = useState(0);
  const [outros, setOutros] = useState(0);
  const [observacoes, setObservacoes] = useState("");
  const [itens, setItens] = useState<LinhaItem[]>([novoItem()]);

  // Scanner / busca rápida por código
  const [codigoBusca, setCodigoBusca] = useState("");
  const [buscando, setBuscando] = useState(false);
  const codigoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setNumero(gerarNumeroCompra());
      setFornecedorId("");
      setDataEmissao(new Date().toISOString().slice(0, 10));
      setDataPrevista("");
      setDataVencimento("");
      setNumeroNf("");
      setDesconto(0);
      setFrete(0);
      setOutros(0);
      setObservacoes("");
      setItens([novoItem()]);
      setCodigoBusca("");
      setTimeout(() => codigoRef.current?.focus(), 150);
    }
  }, [open]);

  const subtotal = useMemo(
    () =>
      itens.reduce(
        (acc, it) => acc + it.quantidade * it.preco_unitario - (it.desconto ?? 0),
        0,
      ),
    [itens],
  );
  const total = Math.max(0, subtotal - desconto + frete + outros);

  function updateItem(key: string, patch: Partial<LinhaItem>) {
    setItens((arr) => arr.map((it) => (it._key === key ? { ...it, ...patch } : it)));
  }
  function removeItem(key: string) {
    setItens((arr) => (arr.length === 1 ? arr : arr.filter((it) => it._key !== key)));
  }

  function adicionarOuIncrementarProduto(opts: {
    produto_id: string;
    nome: string;
    preco_custo: number;
  }) {
    setItens((arr) => {
      // Se já existe item com este produto, incrementa qtd
      const existente = arr.find((i) => i.produto_id === opts.produto_id);
      if (existente) {
        return arr.map((i) =>
          i._key === existente._key ? { ...i, quantidade: i.quantidade + 1 } : i,
        );
      }
      // Se houver linha vazia, preenche ela
      const vazia = arr.find((i) => !i.produto_id);
      if (vazia) {
        return arr.map((i) =>
          i._key === vazia._key
            ? {
                ...i,
                produto_id: opts.produto_id,
                preco_unitario: i.preco_unitario || opts.preco_custo,
                quantidade: i.quantidade || 1,
              }
            : i,
        );
      }
      // Caso contrário, adiciona nova linha
      return [
        ...arr,
        {
          _key: crypto.randomUUID(),
          produto_id: opts.produto_id,
          quantidade: 1,
          preco_unitario: opts.preco_custo,
          desconto: 0,
        },
      ];
    });
  }

  async function handleBuscarCodigo() {
    const v = codigoBusca.trim();
    if (!v) return;
    setBuscando(true);
    try {
      const found = await buscarProdutoPorCodigo(v);
      if (!found) {
        toast.error(`Nenhum produto encontrado para "${v}".`);
        return;
      }
      adicionarOuIncrementarProduto({
        produto_id: found.produto_id,
        nome: found.nome,
        preco_custo: Number(found.preco_custo ?? 0),
      });
      toast.success(`${found.nome} adicionado.`);
      setCodigoBusca("");
      codigoRef.current?.focus();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBuscando(false);
    }
  }

  async function handleSubmit() {
    if (!numero.trim()) return toast.error("Informe o número do pedido.");
    const itensValidos = itens.filter((it) => it.produto_id && it.quantidade > 0);
    if (itensValidos.length === 0) {
      return toast.error("Adicione ao menos um item válido (produto e quantidade).");
    }
    try {
      await create.mutateAsync({
        numero: numero.trim(),
        fornecedor_id: fornecedorId || null,
        data_emissao: dataEmissao,
        data_prevista: dataPrevista || null,
        data_vencimento: dataVencimento || null,
        numero_nf: numeroNf || null,
        desconto,
        frete,
        outros,
        observacoes: observacoes || null,
        itens: itensValidos.map(({ _key: _k, ...rest }) => rest),
      });
      onOpenChange(false);
    } catch {
      /* toast no hook */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova compra</DialogTitle>
          <DialogDescription>
            Crie um pedido de compra. Ao receber (total ou parcial), o estoque é atualizado e o financeiro
            é gerado no recebimento total.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <FormSection
            title="Dados operacionais"
            subtitle="Identificação interna do pedido e datas de controle."
            tone="operacional"
            divider={false}
          >
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="space-y-1.5">
                <Label>Número *</Label>
                <Input value={numero} onChange={(e) => setNumero(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Data emissão</Label>
                <Input type="date" value={dataEmissao} onChange={(e) => setDataEmissao(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Previsão</Label>
                <Input type="date" value={dataPrevista} onChange={(e) => setDataPrevista(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  Vencimento
                  <span className="text-[10px] font-normal text-muted-foreground">(opcional)</span>
                </Label>
                <Input
                  type="date"
                  value={dataVencimento}
                  onChange={(e) => setDataVencimento(e.target.value)}
                  placeholder="Boleto / prazo"
                />
              </div>
            </div>
            {dataVencimento && (
              <p className="text-xs text-muted-foreground">
                Será gerado um lançamento em <strong>Contas a Pagar</strong> com vencimento em{" "}
                {new Date(dataVencimento + "T00:00:00").toLocaleDateString("pt-BR")}.
              </p>
            )}
            <div className="space-y-1.5">
              <Label>Fornecedor</Label>
              <FornecedorSearchSelect
                value={fornecedorId || "none"}
                fornecedores={fornecedores}
                filter={() => true}
                extraOptions={[{ value: "none", label: "Sem fornecedor" }]}
                onChange={(v) => setFornecedorId(v === "none" ? "" : v)}
                placeholder="Selecione um fornecedor"
              />
            </div>
          </FormSection>

          <FormSection
            title="Dados fiscais"
            subtitle="Informações da nota fiscal recebida do fornecedor."
            tone="fiscal"
          >
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="space-y-1.5">
                <Label>Número da NF</Label>
                <Input value={numeroNf} onChange={(e) => setNumeroNf(e.target.value)} placeholder="000123" />
              </div>
            </div>
          </FormSection>

          <FormSection
            title="Itens"
            subtitle="Use o scanner ou busca por código para adicionar rapidamente."
            tone="operacional"
          >
            {/* Scanner / busca por código */}
            <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3 space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs">
                <Barcode className="h-3.5 w-3.5" /> Adicionar por código (SKU, barras ou QR)
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  ref={codigoRef}
                  value={codigoBusca}
                  onChange={(e) => setCodigoBusca(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleBuscarCodigo();
                    }
                  }}
                  placeholder="Bipe ou digite o código e pressione Enter"
                  className="font-mono"
                  disabled={buscando}
                  data-no-enter-advance
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBuscarCodigo}
                  disabled={buscando || !codigoBusca.trim()}
                >
                  {buscando ? "Buscando..." : "Adicionar"}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Linhas do pedido</Label>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => setItens((a) => [...a, novoItem()])}
                >
                  <Plus className="h-4 w-4" /> Adicionar item
                </Button>
              </div>
              <div className="rounded-lg border border-border">
                <div className="grid grid-cols-12 gap-2 border-b border-border bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
                  <div className="col-span-5">Produto</div>
                  <div className="col-span-2 text-right">Qtd</div>
                  <div className="col-span-2 text-right">Custo unit.</div>
                  <div className="col-span-2 text-right">Subtotal</div>
                  <div className="col-span-1" />
                </div>
                {itens.map((it) => {
                  const sub = it.quantidade * it.preco_unitario - (it.desconto ?? 0);
                  return (
                    <div
                      key={it._key}
                      className="grid grid-cols-12 gap-2 border-b border-border px-3 py-2 last:border-b-0 items-center"
                    >
                      <div className="col-span-5">
                        <ProdutoSearchSelect
                          value={it.produto_id || null}
                          onChange={(id, p) => {
                            updateItem(it._key, {
                              produto_id: id,
                              preco_unitario:
                                it.preco_unitario || Number(p?.preco_custo ?? 0),
                            });
                          }}
                          produtos={produtos}
                          filter={() => true}
                        />
                      </div>
                      <div className="col-span-2">
                        <Input
                          type="number"
                          min={0}
                          step="0.001"
                          className="h-9 text-right"
                          value={it.quantidade}
                          onChange={(e) =>
                            updateItem(it._key, { quantidade: Number(e.target.value) })
                          }
                        />
                      </div>
                      <div className="col-span-2">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          className="h-9 text-right"
                          value={it.preco_unitario}
                          onChange={(e) =>
                            updateItem(it._key, { preco_unitario: Number(e.target.value) })
                          }
                        />
                      </div>
                      <div className="col-span-2 text-right text-sm tabular-nums">{fmtBRL(sub)}</div>
                      <div className="col-span-1 text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          onClick={() => removeItem(it._key)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </FormSection>

          <FormSection
            title="Totais e ajustes"
            subtitle="Descontos, frete e outros encargos do pedido."
            tone="financeiro"
          >
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div className="space-y-1.5">
                <Label>Desconto (R$)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={desconto}
                  onChange={(e) => setDesconto(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Frete (R$)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={frete}
                  onChange={(e) => setFrete(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Outros (R$)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={outros}
                  onChange={(e) => setOutros(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Total</Label>
                <div className="flex h-9 items-center justify-end rounded-md border border-border bg-muted/30 px-3 text-base font-semibold tabular-nums">
                  {fmtBRL(total)}
                </div>
              </div>
            </div>
          </FormSection>

          <FormSection title="Informações adicionais" tone="extra">
            <div className="space-y-1.5">
              <Label>Observações</Label>
              <Textarea
                rows={2}
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                maxLength={500}
              />
            </div>
          </FormSection>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={create.isPending}>
            {create.isPending ? "Salvando..." : "Criar pedido"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
