import { useEffect, useMemo, useState } from "react";
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
import { useProdutos } from "@/hooks/useProdutos";
import {
  useCriarMovimentacao,
  useEstoqueSaldos,
  type MovimentacaoTipo,
} from "@/hooks/useEstoque";

interface MovimentacaoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  produtoIdInicial?: string;
}

export function MovimentacaoDialog({ open, onOpenChange, produtoIdInicial }: MovimentacaoDialogProps) {
  const { data: produtos = [] } = useProdutos();
  const { data: saldos } = useEstoqueSaldos();
  const criar = useCriarMovimentacao();

  const [produtoId, setProdutoId] = useState<string>("");
  const [tipo, setTipo] = useState<MovimentacaoTipo>("entrada");
  const [quantidade, setQuantidade] = useState<string>("");
  const [custo, setCusto] = useState<string>("");
  const [observacoes, setObservacoes] = useState<string>("");
  // UUID estável por modal aberto → garante idempotência contra
  // duplo clique, Enter repetido e retry de rede.
  const [clientUuid, setClientUuid] = useState<string>("");

  useEffect(() => {
    if (open) {
      setProdutoId(produtoIdInicial ?? "");
      setTipo("entrada");
      setQuantidade("");
      setCusto("");
      setObservacoes("");
      setClientUuid(crypto.randomUUID());
    }
  }, [open, produtoIdInicial]);

  const saldoAtual = useMemo(
    () => (produtoId ? Number(saldos?.get(produtoId) ?? 0) : 0),
    [produtoId, saldos]
  );

  const qtdNum = Number(quantidade) || 0;
  const previsto = useMemo(() => {
    if (!qtdNum) return saldoAtual;
    if (tipo === "entrada" || tipo === "devolucao") return saldoAtual + qtdNum;
    if (tipo === "saida") return saldoAtual - qtdNum;
    if (tipo === "ajuste") return saldoAtual + qtdNum; // permite negativo no input do ajuste
    return saldoAtual;
  }, [qtdNum, saldoAtual, tipo]);

  const negativo = previsto < 0;

  async function handleSubmit() {
    if (!produtoId) return toast.error("Selecione um produto.");
    if (!qtdNum || qtdNum === 0) return toast.error("Informe a quantidade.");

    const quantidadeAbs = Math.abs(qtdNum);
    // Para ajuste, a quantidade pode ser negativa para reduzir; convertemos em saída.
    let tipoFinal: MovimentacaoTipo = tipo;
    if (tipo === "ajuste" && qtdNum < 0) {
      tipoFinal = "saida";
    }

    try {
      await criar.mutateAsync({
        produto_id: produtoId,
        tipo: tipoFinal,
        quantidade: quantidadeAbs,
        custo_unitario: custo ? Number(custo) : null,
        observacoes: observacoes || null,
        client_uuid: clientUuid,
      });
      onOpenChange(false);
    } catch {/* toast já tratado */}
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova movimentação de estoque</DialogTitle>
          <DialogDescription>
            Registre entradas, saídas ou ajustes manuais. O histórico é mantido automaticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Produto *</Label>
            <Select value={produtoId} onValueChange={setProdutoId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o produto" />
              </SelectTrigger>
              <SelectContent>
                {produtos.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nome} — <span className="font-mono text-xs">{p.sku}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo *</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as MovimentacaoTipo)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="entrada">Entrada</SelectItem>
                  <SelectItem value="saida">Saída</SelectItem>
                  <SelectItem value="ajuste">Ajuste</SelectItem>
                  <SelectItem value="devolucao">Devolução</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Quantidade *</Label>
              <Input type="number" step="0.001" value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
                placeholder={tipo === "ajuste" ? "Use negativo para reduzir" : "0"} />
            </div>
          </div>

          {produtoId && (
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
              <div>
                <p className="text-xs text-muted-foreground">Saldo atual</p>
                <p className="text-lg font-semibold tabular-nums">{saldoAtual.toLocaleString("pt-BR")}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Saldo previsto</p>
                <p className={`text-lg font-semibold tabular-nums ${negativo ? "text-destructive" : "text-success"}`}>
                  {previsto.toLocaleString("pt-BR")}
                </p>
              </div>
              {negativo && (
                <p className="col-span-2 text-xs text-destructive">
                  ⚠ Estoque ficaria negativo. Ajuste a quantidade ou faça uma entrada antes.
                </p>
              )}
            </div>
          )}

          {(tipo === "entrada" || tipo === "devolucao") && (
            <div className="space-y-1.5">
              <Label>Custo unitário (opcional)</Label>
              <Input type="number" min={0} step="0.01" value={custo}
                onChange={(e) => setCusto(e.target.value)} placeholder="R$ 0,00" />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Observação</Label>
            <Textarea rows={2} value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              placeholder="Motivo da movimentação..." maxLength={500} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={criar.isPending || negativo}>
            {criar.isPending ? "Registrando..." : "Registrar movimentação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
