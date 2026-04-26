import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Receipt, Wallet, AlertCircle } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/mock-data";

type Mode = "individual" | "lote";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Para conciliação individual */
  lancamentoId?: string | null;
  valorVenda?: number;
  descricaoVenda?: string;
  mode?: Mode;
}

interface PendenteRow {
  id: string;
  descricao: string;
  valor: number;
  data_emissao: string;
  cliente_nome: string | null;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function ConciliarIfoodDialog({
  open,
  onOpenChange,
  lancamentoId,
  valorVenda,
  descricaoVenda,
  mode = "individual",
}: Props) {
  const qc = useQueryClient();
  const [dataRepasse, setDataRepasse] = useState(todayISO());
  const [valorRepasse, setValorRepasse] = useState("");
  const [numeroRepasse, setNumeroRepasse] = useState("");
  const [observacao, setObservacao] = useState("");
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  // Reset ao abrir
  useEffect(() => {
    if (open) {
      setDataRepasse(todayISO());
      setNumeroRepasse("");
      setObservacao("");
      setSelecionados(new Set());
      setValorRepasse(
        mode === "individual" && valorVenda != null ? String(valorVenda.toFixed(2)) : "",
      );
    }
  }, [open, mode, valorVenda]);

  // Lista pendentes (modo lote)
  const { data: pendentes = [], isLoading: loadingPendentes } = useQuery({
    queryKey: ["ifood_pendentes"],
    enabled: open && mode === "lote",
    queryFn: async (): Promise<PendenteRow[]> => {
      const { data, error } = await supabase
        .from("financeiro_lancamentos")
        .select(
          "id, descricao, valor, data_emissao, cliente:clientes(nome)",
        )
        .eq("forma_pagamento", "ifood")
        .eq("status", "pendente")
        .order("data_emissao", { ascending: true })
        .limit(500);
      if (error) throw error;
      type Row = {
        id: string;
        descricao: string;
        valor: number;
        data_emissao: string;
        cliente: { nome: string | null } | null;
      };
      return ((data ?? []) as Row[]).map((r) => ({
        id: r.id,
        descricao: r.descricao,
        valor: Number(r.valor),
        data_emissao: r.data_emissao,
        cliente_nome: r.cliente?.nome ?? null,
      }));
    },
  });

  const pendentesSelecionados = useMemo(
    () => pendentes.filter((p) => selecionados.has(p.id)),
    [pendentes, selecionados],
  );
  const totalBrutoSel = useMemo(
    () => pendentesSelecionados.reduce((s, p) => s + p.valor, 0),
    [pendentesSelecionados],
  );

  const valorRepasseNum = Number(valorRepasse.replace(",", ".")) || 0;
  const baseBruto = mode === "individual" ? Number(valorVenda ?? 0) : totalBrutoSel;
  const taxa = Math.max(baseBruto - valorRepasseNum, 0);
  const valorMaiorQueBruto = valorRepasseNum > baseBruto + 0.005;

  const conciliar = useMutation({
    mutationFn: async () => {
      if (!dataRepasse) throw new Error("Informe a data do repasse.");
      if (valorRepasseNum <= 0) throw new Error("Informe o valor do repasse.");
      if (valorMaiorQueBruto)
        throw new Error("Valor do repasse não pode ser maior que o valor bruto.");

      if (mode === "individual") {
        if (!lancamentoId) throw new Error("Lançamento inválido.");
        const { error } = await supabase.rpc("conciliar_ifood_lancamento", {
          _lancamento_id: lancamentoId,
          _data_repasse: dataRepasse,
          _valor_repasse: valorRepasseNum,
          _numero_repasse: numeroRepasse || undefined,
          _observacao: observacao || undefined,
        });
        if (error) throw error;
      } else {
        if (selecionados.size === 0)
          throw new Error("Selecione ao menos um lançamento.");
        const { error } = await supabase.rpc("conciliar_ifood_lote", {
          _lancamento_ids: Array.from(selecionados),
          _data_repasse: dataRepasse,
          _valor_repasse_total: valorRepasseNum,
          _numero_repasse: numeroRepasse || undefined,
          _observacao: observacao || undefined,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["financeiro_lancamentos"] });
      qc.invalidateQueries({ queryKey: ["financeiro"] });
      qc.invalidateQueries({ queryKey: ["ifood_pendentes"] });
      qc.invalidateQueries({ queryKey: ["ifood_repasses"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(
        mode === "individual"
          ? "Repasse iFood conciliado."
          : `Repasse de ${pendentesSelecionados.length} venda(s) conciliado.`,
      );
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message ?? "Falha ao conciliar repasse."),
  });

  const toggleAll = (checked: boolean) => {
    setSelecionados(checked ? new Set(pendentes.map((p) => p.id)) : new Set());
  };
  const toggleOne = (id: string, checked: boolean) => {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            {mode === "individual" ? "Conciliar repasse iFood" : "Conciliar repasse iFood em lote"}
          </DialogTitle>
          <DialogDescription>
            {mode === "individual"
              ? descricaoVenda ?? "Confirme o recebimento do repasse desta venda."
              : "Selecione as vendas iFood pendentes que entraram neste repasse."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          {mode === "lote" && (
            <div className="rounded-md border border-border">
              <ScrollArea className="h-[260px]">
                <Table>
                  <TableHeader className="sticky top-0 bg-card">
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={
                            pendentes.length > 0 && selecionados.size === pendentes.length
                          }
                          onCheckedChange={(c) => toggleAll(c === true)}
                          aria-label="Selecionar todos"
                        />
                      </TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Emissão</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingPendentes ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                          Carregando…
                        </TableCell>
                      </TableRow>
                    ) : pendentes.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                          Nenhum lançamento iFood pendente.
                        </TableCell>
                      </TableRow>
                    ) : (
                      pendentes.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>
                            <Checkbox
                              checked={selecionados.has(p.id)}
                              onCheckedChange={(c) => toggleOne(p.id, c === true)}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{p.descricao}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {p.cliente_nome ?? "—"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {p.data_emissao.split("-").reverse().join("/")}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatBRL(p.valor)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
              <div className="flex items-center justify-between border-t border-border bg-muted/30 px-3 py-2 text-sm">
                <span className="text-muted-foreground">
                  {selecionados.size} de {pendentes.length} selecionado(s)
                </span>
                <span className="font-mono font-semibold tabular-nums">
                  Bruto: {formatBRL(totalBrutoSel)}
                </span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="data-repasse">Data do repasse *</Label>
              <Input
                id="data-repasse"
                type="date"
                value={dataRepasse}
                onChange={(e) => setDataRepasse(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="valor-repasse">Valor recebido (R$) *</Label>
              <Input
                id="valor-repasse"
                type="number"
                step="0.01"
                min="0"
                value={valorRepasse}
                onChange={(e) => setValorRepasse(e.target.value)}
                placeholder="0,00"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="num-repasse">Nº do repasse / extrato</Label>
              <Input
                id="num-repasse"
                value={numeroRepasse}
                onChange={(e) => setNumeroRepasse(e.target.value)}
                placeholder="Ex: REP-202604-001"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="obs-repasse">Observação</Label>
              <Textarea
                id="obs-repasse"
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                rows={2}
                placeholder="Notas sobre este repasse (opcional)"
              />
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-md border border-border bg-card/40 p-3">
              <p className="text-xs text-muted-foreground">Valor bruto</p>
              <p className="mt-1 font-mono text-base font-semibold tabular-nums">
                {formatBRL(baseBruto)}
              </p>
            </div>
            <div className="rounded-md border border-border bg-card/40 p-3">
              <p className="text-xs text-muted-foreground">Valor recebido</p>
              <p className="mt-1 font-mono text-base font-semibold tabular-nums text-success">
                {formatBRL(valorRepasseNum)}
              </p>
            </div>
            <div className="rounded-md border border-border bg-card/40 p-3">
              <p className="text-xs text-muted-foreground">Taxa iFood</p>
              <p className="mt-1 font-mono text-base font-semibold tabular-nums text-warning">
                {formatBRL(taxa)}
              </p>
            </div>
          </div>

          {valorMaiorQueBruto && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              O valor recebido não pode ser maior que o valor bruto.
            </div>
          )}
          {taxa > 0 && !valorMaiorQueBruto && (
            <p className="text-xs text-muted-foreground">
              <Wallet className="mr-1 inline h-3 w-3" />A diferença será registrada
              automaticamente como despesa <strong>Taxa iFood</strong>.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={conciliar.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() => conciliar.mutate()}
            disabled={
              conciliar.isPending ||
              valorMaiorQueBruto ||
              valorRepasseNum <= 0 ||
              (mode === "lote" && selecionados.size === 0)
            }
            className="gap-1.5 bg-success text-success-foreground hover:bg-success/90"
          >
            <CheckCircle2 className="h-4 w-4" />
            Confirmar repasse
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
