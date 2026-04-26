import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle, Calendar, FileText, User, Wallet, Tag, Clock } from "lucide-react";
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
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/mock-data";

export type LancamentoDetalhe = {
  id: string;
  descricao: string;
  valor: number;
  valor_pago: number | null;
  data_vencimento: string;
  data_pagamento: string | null;
  data_emissao?: string | null;
  tipo: "receber" | "pagar";
  status: "pendente" | "recebido" | "pago" | "cancelado" | "parcial" | "vencido";
  observacoes?: string | null;
  numero_documento?: string | null;
  fornecedor_nome?: string | null;
  cliente_nome?: string | null;
  categoria_nome?: string | null;
  forma_pagamento?: string | null;
  created_at?: string | null;
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lancamento: LancamentoDetalhe | null;
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  // Aceita "YYYY-MM-DD" ou ISO completo
  const onlyDate = d.length === 10 ? d : d.slice(0, 10);
  const [y, m, day] = onlyDate.split("-");
  if (!y || !m || !day) return d;
  return `${day}/${m}/${y}`;
}

function statusInfo(l: LancamentoDetalhe): { label: string; tone: "success" | "warning" | "danger" | "neutral" | "info" } {
  if (l.status === "pago" || l.status === "recebido") return { label: "Pago", tone: "success" };
  if (l.status === "cancelado") return { label: "Cancelado", tone: "danger" };
  if (l.status === "parcial") return { label: "Parcial", tone: "info" };
  if (l.data_vencimento && new Date(l.data_vencimento) < new Date(new Date().toDateString())) {
    return { label: "Vencido", tone: "danger" };
  }
  return { label: "Pendente", tone: "warning" };
}

function Field({ icon: Icon, label, children }: { icon: typeof Calendar; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <div className="mt-0.5 text-sm text-foreground">{children}</div>
      </div>
    </div>
  );
}

export function LancamentoDetalheDialog({ open, onOpenChange, lancamento }: Props) {
  const qc = useQueryClient();

  const updateStatus = useMutation({
    mutationFn: async (novoStatus: "pago" | "recebido" | "cancelado") => {
      if (!lancamento) return;
      const patch: Record<string, unknown> = { status: novoStatus };
      if (novoStatus === "pago" || novoStatus === "recebido") {
        patch.data_pagamento = new Date().toISOString().slice(0, 10);
        patch.valor_pago = Number(lancamento.valor);
      }
      if (novoStatus === "cancelado") {
        patch.data_pagamento = null;
        patch.valor_pago = 0;
      }
      const { error } = await supabase
        .from("financeiro_lancamentos")
        .update(patch)
        .eq("id", lancamento.id);
      if (error) throw error;
    },
    onSuccess: (_d, novoStatus) => {
      qc.invalidateQueries({ queryKey: ["financeiro_lancamentos"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(
        novoStatus === "cancelado" ? "Lançamento cancelado." : "Lançamento marcado como pago.",
      );
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message ?? "Não foi possível atualizar o lançamento."),
  });

  if (!lancamento) return null;
  const info = statusInfo(lancamento);
  const isPagar = lancamento.tipo === "pagar";
  const jaResolvido =
    lancamento.status === "pago" ||
    lancamento.status === "recebido" ||
    lancamento.status === "cancelado";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3">
            <span className="truncate">{lancamento.descricao}</span>
            <StatusBadge status={info.label} tone={info.tone} />
          </DialogTitle>
          <DialogDescription>
            {isPagar ? "Conta a pagar" : "Conta a receber"} • {formatBRL(Number(lancamento.valor))}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field icon={Wallet} label="Valor">
              <span className="text-base font-semibold">{formatBRL(Number(lancamento.valor))}</span>
            </Field>
            <Field icon={Calendar} label="Vencimento">
              {formatDate(lancamento.data_vencimento)}
            </Field>
            <Field icon={Calendar} label="Emissão">
              {formatDate(lancamento.data_emissao ?? null)}
            </Field>
            <Field icon={CheckCircle2} label="Pagamento">
              {formatDate(lancamento.data_pagamento)}
            </Field>
            {(lancamento.fornecedor_nome || lancamento.cliente_nome) && (
              <Field icon={User} label={isPagar ? "Fornecedor" : "Cliente"}>
                {lancamento.fornecedor_nome ?? lancamento.cliente_nome ?? "—"}
              </Field>
            )}
            {lancamento.categoria_nome && (
              <Field icon={Tag} label="Categoria">
                {lancamento.categoria_nome}
              </Field>
            )}
            {lancamento.forma_pagamento && (
              <Field icon={Wallet} label="Forma">
                {lancamento.forma_pagamento}
              </Field>
            )}
            {lancamento.numero_documento && (
              <Field icon={FileText} label="Documento">
                {lancamento.numero_documento}
              </Field>
            )}
            {lancamento.created_at && (
              <Field icon={Clock} label="Criado em">
                {formatDate(lancamento.created_at)}
              </Field>
            )}
          </div>

          {lancamento.observacoes && (
            <>
              <Separator />
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Observações</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                  {lancamento.observacoes}
                </p>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={updateStatus.isPending}
          >
            Fechar
          </Button>
          {!jaResolvido && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                onClick={() => updateStatus.mutate("cancelado")}
                disabled={updateStatus.isPending}
                className="gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <XCircle className="h-4 w-4" />
                Cancelar título
              </Button>
              <Button
                onClick={() => updateStatus.mutate(isPagar ? "pago" : "recebido")}
                disabled={updateStatus.isPending}
                className="gap-1.5 bg-success text-success-foreground hover:bg-success/90"
              >
                <CheckCircle2 className="h-4 w-4" />
                {isPagar ? "Marcar como pago" : "Marcar como recebido"}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
