import { useEffect, useMemo, useState } from "react";
import { PackageCheck } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCompra, useReceberCompraItens } from "@/hooks/useCompras";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  compraId: string | null;
}

const fmtBRL = (n: number) =>
  Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtNum = (n: number) =>
  Number(n ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 });

export function ReceberCompraDialog({ open, onOpenChange, compraId }: Props) {
  const { data: compra } = useCompra(compraId ?? undefined);
  const receber = useReceberCompraItens();

  // mapa item_id -> quantidade desta remessa
  const [quantidades, setQuantidades] = useState<Record<string, number>>({});
  const [gerarFinanceiro, setGerarFinanceiro] = useState(true);
  const [vencimento, setVencimento] = useState(new Date().toISOString().slice(0, 10));
  const [dataRecebimento, setDataRecebimento] = useState(new Date().toISOString().slice(0, 10));

  // Quando abrir o dialog, sugere "receber tudo o que falta"
  useEffect(() => {
    if (!open || !compra) return;
    const initial: Record<string, number> = {};
    for (const it of compra.itens ?? []) {
      const pendente = Number(it.quantidade) - Number(it.quantidade_recebida ?? 0);
      initial[it.id] = Math.max(0, pendente);
    }
    setQuantidades(initial);
    setGerarFinanceiro(true);
    setVencimento(new Date().toISOString().slice(0, 10));
    setDataRecebimento(new Date().toISOString().slice(0, 10));
  }, [open, compra]);

  const linhas = useMemo(() => {
    if (!compra) return [];
    return (compra.itens ?? []).map((it) => {
      const total = Number(it.quantidade);
      const recebido = Number(it.quantidade_recebida ?? 0);
      const pendente = Math.max(0, total - recebido);
      const remessa = quantidades[it.id] ?? 0;
      return { it, total, recebido, pendente, remessa };
    });
  }, [compra, quantidades]);

  const resumo = useMemo(() => {
    const totalRemessa = linhas.reduce((acc, l) => acc + l.remessa, 0);
    const valorRemessa = linhas.reduce(
      (acc, l) => acc + l.remessa * Number(l.it.preco_unitario ?? 0),
      0,
    );
    const aindaPendente = linhas.reduce((acc, l) => acc + (l.pendente - l.remessa), 0);
    const recebeTudo = aindaPendente <= 0 && totalRemessa > 0;
    return { totalRemessa, valorRemessa, aindaPendente, recebeTudo };
  }, [linhas]);

  function setQtd(itemId: string, valor: number, max: number) {
    const v = Math.max(0, Math.min(max, Number.isFinite(valor) ? valor : 0));
    setQuantidades((prev) => ({ ...prev, [itemId]: v }));
  }

  function receberTudo() {
    const next: Record<string, number> = {};
    for (const l of linhas) next[l.it.id] = l.pendente;
    setQuantidades(next);
  }

  function zerar() {
    const next: Record<string, number> = {};
    for (const l of linhas) next[l.it.id] = 0;
    setQuantidades(next);
  }

  async function handleConfirm() {
    if (!compraId) return;
    const itens = linhas
      .filter((l) => l.remessa > 0)
      .map((l) => ({ item_id: l.it.id, quantidade: l.remessa }));
    if (itens.length === 0) {
      toast.error("Informe a quantidade recebida de pelo menos um item.");
      return;
    }
    try {
      await receber.mutateAsync({
        compra_id: compraId,
        itens,
        data_recebimento: dataRecebimento,
        gerar_financeiro: resumo.recebeTudo ? gerarFinanceiro : false,
        data_vencimento: resumo.recebeTudo && gerarFinanceiro ? vencimento : null,
      });
      onOpenChange(false);
    } catch {
      /* toast no hook */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5 text-success" />
            Receber compra {compra?.numero ?? ""}
          </DialogTitle>
          <DialogDescription>
            Informe a quantidade recebida de cada item. É possível receber em mais de uma remessa.
          </DialogDescription>
        </DialogHeader>

        {!compra ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={receberTudo}>
                Receber tudo
              </Button>
              <Button size="sm" variant="ghost" onClick={zerar}>
                Zerar
              </Button>
              <div className="ml-auto flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Data do recebimento</Label>
                <Input
                  type="date"
                  className="h-8 w-40"
                  value={dataRecebimento}
                  onChange={(e) => setDataRecebimento(e.target.value)}
                />
              </div>
            </div>

            <div className="rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Pedido</TableHead>
                    <TableHead className="text-right">Já recebido</TableHead>
                    <TableHead className="text-right">Pendente</TableHead>
                    <TableHead className="text-right w-32">Receber agora</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linhas.map(({ it, total, recebido, pendente, remessa }) => {
                    const completo = pendente === 0;
                    return (
                      <TableRow key={it.id} className={completo ? "opacity-60" : ""}>
                        <TableCell>
                          <div className="font-medium">{it.produto?.nome ?? it.descricao ?? "—"}</div>
                          {it.produto?.sku && (
                            <div className="font-mono text-xs text-muted-foreground">
                              {it.produto.sku}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtNum(total)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {fmtNum(recebido)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {fmtNum(pendente)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            max={pendente}
                            step="0.001"
                            disabled={completo}
                            className="h-9 text-right"
                            value={remessa}
                            onChange={(e) => setQtd(it.id, Number(e.target.value), pendente)}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 space-y-3">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Itens nesta remessa</p>
                  <p className="font-semibold tabular-nums">{fmtNum(resumo.totalRemessa)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Valor desta remessa</p>
                  <p className="font-semibold tabular-nums">{fmtBRL(resumo.valorRemessa)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Saldo após remessa</p>
                  <p className="font-semibold tabular-nums">
                    {resumo.aindaPendente <= 0 ? "0" : fmtNum(resumo.aindaPendente)}
                  </p>
                </div>
              </div>

              {resumo.recebeTudo && (
                <>
                  <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">Gerar conta a pagar</p>
                      <p className="text-xs text-muted-foreground">
                        Lançamento financeiro vinculado à compra (criado apenas no recebimento total).
                      </p>
                    </div>
                    <Switch checked={gerarFinanceiro} onCheckedChange={setGerarFinanceiro} />
                  </div>
                  {gerarFinanceiro && (
                    <div className="space-y-1.5">
                      <Label>Vencimento</Label>
                      <Input
                        type="date"
                        value={vencimento}
                        onChange={(e) => setVencimento(e.target.value)}
                      />
                    </div>
                  )}
                </>
              )}
              {!resumo.recebeTudo && resumo.totalRemessa > 0 && (
                <p className="text-xs text-info">
                  A compra ficará com status <strong>Recebida parcial</strong>. O lançamento financeiro
                  será gerado apenas quando todos os itens forem recebidos.
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            className="gap-1.5"
            onClick={handleConfirm}
            disabled={receber.isPending || resumo.totalRemessa === 0}
          >
            <PackageCheck className="h-4 w-4" />
            {receber.isPending ? "Recebendo..." : "Confirmar recebimento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
