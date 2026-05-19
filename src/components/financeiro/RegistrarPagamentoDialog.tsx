import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dataClient } from "@/integrations/data";
import { formatBRL } from "@/lib/mock-data";
import { useHotkeys } from "@/hooks/useHotkeys";
import { FormSection } from "@/components/shared/FormSection";

type FormaPag =
  | "dinheiro"
  | "pix"
  | "cartao_credito"
  | "cartao_debito"
  | "boleto"
  | "transferencia"
  | "cheque"
  | "fiado"
  | "ifood"
  | "outro";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lancamentoId: string;
  ownerId: string;
  saldoRestante: number;
  valorTotal: number;
  descricao: string;
  tipo: "receber" | "pagar";
  /** Quando true, sugere valor total (baixa total) */
  modoTotal?: boolean;
}

export function RegistrarPagamentoDialog({
  open,
  onOpenChange,
  lancamentoId,
  ownerId,
  saldoRestante,
  valorTotal,
  descricao,
  tipo,
  modoTotal = false,
}: Props) {
  const qc = useQueryClient();
  const [valor, setValor] = useState<string>("");
  const [data, setData] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [forma, setForma] = useState<FormaPag>("dinheiro");
  const [obs, setObs] = useState<string>("");
  // client_uuid estável por modal aberto: garante idempotência contra
  // duplo-clique, Enter repetido e retry de rede. Reset ao reabrir.
  const [clientUuid, setClientUuid] = useState<string>("");

  useEffect(() => {
    if (open) {
      const sug = modoTotal ? saldoRestante : Math.min(saldoRestante, valorTotal);
      setValor(sug > 0 ? sug.toFixed(2).replace(".", ",") : "");
      setData(new Date().toISOString().slice(0, 10));
      setForma("dinheiro");
      setObs("");
      setClientUuid(crypto.randomUUID());
    }
  }, [open, modoTotal, saldoRestante, valorTotal]);

  const valorNum = (() => {
    const n = Number(String(valor).replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  })();

  const podeSalvar = valorNum > 0 && valorNum <= saldoRestante + 0.005 && !!data;

  const salvar = useMutation({
    mutationFn: async () => {
      await dataClient.financeiro.registrarPagamento({
        lancamento_id: lancamentoId,
        valor: valorNum,
        data_pagamento: data,
        forma_pagamento: forma,
        observacao: obs.trim() || null,
        client_uuid: clientUuid || null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["financeiro_lancamentos"] });
      qc.invalidateQueries({ queryKey: ["lancamento_pagamentos", lancamentoId] });
      qc.invalidateQueries({ queryKey: ["financeiro_indicadores_mes"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["relatorio_contas_receber"] });
      toast.success(
        valorNum >= saldoRestante - 0.005
          ? `${tipo === "pagar" ? "Pagamento" : "Recebimento"} total registrado.`
          : `Pagamento parcial de ${formatBRL(valorNum)} registrado.`,
      );
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message ?? "Falha ao registrar pagamento."),
  });

  useHotkeys(
    [
      {
        key: "Enter",
        allowInInputs: true,
        handler: (e) => {
          const active = document.activeElement as HTMLElement | null;
          if (active && active.tagName === "TEXTAREA") return;
          if (!podeSalvar || salvar.isPending) return;
          e.preventDefault();
          salvar.mutate();
        },
      },
      {
        key: "Escape",
        allowInInputs: true,
        handler: () => {
          if (!salvar.isPending) onOpenChange(false);
        },
      },
    ],
    { enabled: open, scope: "modal" },
  );

  if (import.meta.env.DEV && open) {
    // eslint-disable-next-line no-console
    console.debug("[FORM_LAYOUT] financeiro seção renderizada", {
      modo: tipo === "pagar" ? "registrar_pagamento" : "registrar_recebimento",
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Registrar {tipo === "pagar" ? "pagamento" : "recebimento"}
          </DialogTitle>
          <DialogDescription className="truncate">{descricao}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/30 p-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Valor do título</p>
            <p className="font-mono tabular-nums">{formatBRL(valorTotal)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Saldo restante</p>
            <p className="font-mono font-semibold tabular-nums text-warning">
              {formatBRL(saldoRestante)}
            </p>
          </div>
        </div>

        <div className="space-y-5 py-1">
          <FormSection
            title="Valor e data"
            subtitle="Quanto e quando foi recebido/pago."
            tone="financeiro"
            divider={false}
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pag-valor">Valor recebido *</Label>
                <Input
                  id="pag-valor"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  inputMode="decimal"
                  placeholder="0,00"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pag-data">Data *</Label>
                <Input
                  id="pag-data"
                  type="date"
                  value={data}
                  onChange={(e) => setData(e.target.value)}
                />
              </div>
            </div>

            {valorNum > saldoRestante + 0.005 && (
              <p className="text-xs font-medium text-destructive">
                Valor maior que o saldo restante ({formatBRL(saldoRestante)}).
              </p>
            )}
          </FormSection>

          <FormSection title="Forma de pagamento" tone="operacional">
            <div className="space-y-1.5">
              <Label>Forma</Label>
              <Select value={forma} onValueChange={(v) => setForma(v as FormaPag)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dinheiro">Dinheiro</SelectItem>
                  <SelectItem value="pix">PIX</SelectItem>
                  <SelectItem value="cartao_debito">Débito</SelectItem>
                  <SelectItem value="cartao_credito">Crédito</SelectItem>
                  <SelectItem value="boleto">Boleto</SelectItem>
                  <SelectItem value="transferencia">Transferência</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="ifood">iFood</SelectItem>
                  <SelectItem value="fiado">Fiado</SelectItem>
                  <SelectItem value="outro">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </FormSection>

          <FormSection title="Histórico" tone="extra">
            <div className="space-y-1.5">
              <Label htmlFor="pag-obs">Observação</Label>
              <Textarea
                id="pag-obs"
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                rows={2}
                placeholder="Opcional"
              />
            </div>
          </FormSection>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={salvar.isPending}
          >
            Cancelar <kbd className="ml-2 rounded bg-muted px-1.5 text-[10px]">Esc</kbd>
          </Button>
          <Button
            onClick={() => salvar.mutate()}
            disabled={!podeSalvar || salvar.isPending}
            className="bg-success text-success-foreground hover:bg-success/90"
          >
            {salvar.isPending ? "Salvando..." : "Confirmar"}
            <kbd className="ml-2 rounded bg-background/20 px-1.5 text-[10px]">Enter</kbd>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
