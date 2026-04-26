import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  XCircle,
  Calendar,
  FileText,
  User,
  Wallet,
  Tag,
  Clock,
  Receipt,
  Phone,
  IdCard,
  ShoppingCart,
  History,
  HandCoins,
  Trash2,
} from "lucide-react";
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
import { useHotkeys } from "@/hooks/useHotkeys";
import { ConciliarIfoodDialog } from "./ConciliarIfoodDialog";
import { RegistrarPagamentoDialog } from "./RegistrarPagamentoDialog";

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
  fornecedor_documento?: string | null;
  fornecedor_telefone?: string | null;
  cliente_id?: string | null;
  cliente_nome?: string | null;
  cliente_documento?: string | null;
  cliente_telefone?: string | null;
  cliente_email?: string | null;
  venda_id?: string | null;
  venda_numero?: string | null;
  venda_data?: string | null;
  venda_total?: number | null;
  categoria_nome?: string | null;
  forma_pagamento?: string | null;
  created_at?: string | null;
  conciliado_em?: string | null;
  valor_repasse?: number | null;
  taxa_repasse?: number | null;
  numero_repasse?: string | null;
  observacao_repasse?: string | null;
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lancamento: LancamentoDetalhe | null;
}

interface PagamentoHist {
  id: string;
  valor: number;
  data_pagamento: string;
  forma_pagamento: string | null;
  observacao: string | null;
  created_at: string;
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  const onlyDate = d.length === 10 ? d : d.slice(0, 10);
  const [y, m, day] = onlyDate.split("-");
  if (!y || !m || !day) return d;
  return `${day}/${m}/${y}`;
}

function statusInfo(l: LancamentoDetalhe): {
  label: string;
  tone: "success" | "warning" | "danger" | "neutral" | "info";
} {
  if (l.status === "pago" || l.status === "recebido") return { label: "Pago", tone: "success" };
  if (l.status === "cancelado") return { label: "Cancelado", tone: "danger" };
  if (l.status === "parcial") return { label: "Parcialmente pago", tone: "info" };
  if (l.data_vencimento && new Date(l.data_vencimento) < new Date(new Date().toDateString())) {
    return { label: "Vencido", tone: "danger" };
  }
  return { label: "Pendente", tone: "warning" };
}

function formatDoc(doc: string | null | undefined): string {
  if (!doc) return "—";
  const d = doc.replace(/\D/g, "");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14)
    return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return doc;
}

function Field({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Calendar;
  label: string;
  children: React.ReactNode;
}) {
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
  const [conciliarOpen, setConciliarOpen] = useState(false);
  const [pagamentoOpen, setPagamentoOpen] = useState(false);
  const [pagamentoModoTotal, setPagamentoModoTotal] = useState(false);

  // Carrega histórico de pagamentos do título
  const { data: pagamentos = [] } = useQuery({
    queryKey: ["lancamento_pagamentos", lancamento?.id],
    enabled: open && !!lancamento?.id,
    queryFn: async (): Promise<PagamentoHist[]> => {
      if (!lancamento?.id) return [];
      const { data, error } = await (supabase.from as unknown as (
        t: string,
      ) => {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            order: (
              col: string,
              opts?: { ascending?: boolean },
            ) => Promise<{ data: PagamentoHist[] | null; error: { message: string } | null }>;
          };
        };
      })("lancamento_pagamentos")
        .select("id, valor, data_pagamento, forma_pagamento, observacao, created_at")
        .eq("lancamento_id", lancamento.id)
        .order("data_pagamento", { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const cancelarTitulo = useMutation({
    mutationFn: async () => {
      if (!lancamento) return;
      const { error } = await supabase
        .from("financeiro_lancamentos")
        .update({ status: "cancelado" })
        .eq("id", lancamento.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["financeiro_lancamentos"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["financeiro_indicadores_mes"] });
      toast.success("Título cancelado.");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message ?? "Não foi possível cancelar."),
  });

  const reabrirTitulo = useMutation({
    mutationFn: async () => {
      if (!lancamento) return;
      const totalPago = pagamentos.reduce((s, p) => s + Number(p.valor), 0);
      const novoStatus: "pendente" | "pago" | "recebido" =
        totalPago <= 0
          ? "pendente"
          : totalPago >= Number(lancamento.valor)
            ? lancamento.tipo === "pagar"
              ? "pago"
              : "recebido"
            : "pendente"; // 'parcial' não está no enum gerado; mantém pendente
      const { error } = await supabase
        .from("financeiro_lancamentos")
        .update({ status: novoStatus })
        .eq("id", lancamento.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["financeiro_lancamentos"] });
      toast.success("Título reaberto.");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message ?? "Não foi possível reabrir."),
  });

  const removerPagamento = useMutation({
    mutationFn: async (pagId: string) => {
      const { error } = await (supabase.from as unknown as (
        t: string,
      ) => {
        delete: () => {
          eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
        };
      })("lancamento_pagamentos").delete().eq("id", pagId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lancamento_pagamentos", lancamento?.id] });
      qc.invalidateQueries({ queryKey: ["financeiro_lancamentos"] });
      qc.invalidateQueries({ queryKey: ["financeiro_indicadores_mes"] });
      toast.success("Pagamento removido.");
    },
    onError: (e: Error) => toast.error(e.message ?? "Falha ao remover."),
  });

  // hotkeys: P = pagamento parcial, B = baixa total, Esc fecha (já tratado pelo Dialog)
  useHotkeys(
    [
      {
        key: "p",
        handler: () => {
          if (!lancamento) return;
          if (jaResolvido) return;
          if (isIfoodPendente) return;
          setPagamentoModoTotal(false);
          setPagamentoOpen(true);
        },
      },
      {
        key: "b",
        handler: () => {
          if (!lancamento) return;
          if (jaResolvido) return;
          if (isIfoodPendente) return;
          setPagamentoModoTotal(true);
          setPagamentoOpen(true);
        },
      },
    ],
    { enabled: open && !pagamentoOpen && !conciliarOpen, scope: "modal" },
  );

  if (!lancamento) return null;
  const info = statusInfo(lancamento);
  const isPagar = lancamento.tipo === "pagar";
  const totalPago = Number(lancamento.valor_pago ?? 0);
  const valorTotal = Number(lancamento.valor);
  const saldoRestante = Math.max(0, valorTotal - totalPago);
  const jaResolvido =
    lancamento.status === "pago" ||
    lancamento.status === "recebido" ||
    lancamento.status === "cancelado";
  const isIfoodPendente =
    lancamento.forma_pagamento === "ifood" && !jaResolvido && lancamento.tipo === "receber";
  const temAuditoriaRepasse = !!lancamento.conciliado_em;
  const temCliente = !!(lancamento.cliente_nome || lancamento.cliente_documento);
  const temVenda = !!(lancamento.venda_id || lancamento.venda_numero);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-3">
              <span className="truncate">{lancamento.descricao}</span>
              <StatusBadge status={info.label} tone={info.tone} />
            </DialogTitle>
            <DialogDescription>
              {isPagar ? "Conta a pagar" : "Conta a receber"} • {formatBRL(valorTotal)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Resumo financeiro */}
            <div className="grid grid-cols-3 gap-3 rounded-md border bg-muted/30 p-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Valor original</p>
                <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
                  {formatBRL(valorTotal)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Já pago</p>
                <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-success">
                  {formatBRL(totalPago)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Saldo restante
                </p>
                <p
                  className={
                    "mt-0.5 font-mono text-sm font-semibold tabular-nums " +
                    (saldoRestante > 0 ? "text-warning" : "text-muted-foreground")
                  }
                >
                  {formatBRL(saldoRestante)}
                </p>
              </div>
            </div>

            {/* Datas e status */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field icon={Calendar} label="Vencimento">
                {formatDate(lancamento.data_vencimento)}
              </Field>
              <Field icon={Calendar} label="Emissão">
                {formatDate(lancamento.data_emissao ?? null)}
              </Field>
              <Field icon={CheckCircle2} label="Último pagamento">
                {formatDate(lancamento.data_pagamento)}
              </Field>
              {lancamento.forma_pagamento && (
                <Field icon={Wallet} label="Forma original">
                  {lancamento.forma_pagamento}
                </Field>
              )}
              {lancamento.categoria_nome && (
                <Field icon={Tag} label="Categoria">
                  {lancamento.categoria_nome}
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

            {/* Cliente / Fornecedor */}
            {(temCliente || lancamento.fornecedor_nome) && (
              <>
                <Separator />
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {isPagar ? "Fornecedor" : "Cliente"}
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field icon={User} label="Nome">
                      {lancamento.fornecedor_nome ?? lancamento.cliente_nome ?? "—"}
                    </Field>
                    {(lancamento.cliente_documento || lancamento.fornecedor_documento) && (
                      <Field icon={IdCard} label="CPF/CNPJ">
                        {formatDoc(
                          lancamento.cliente_documento ?? lancamento.fornecedor_documento,
                        )}
                      </Field>
                    )}
                    {(lancamento.cliente_telefone || lancamento.fornecedor_telefone) && (
                      <Field icon={Phone} label="Telefone">
                        {lancamento.cliente_telefone ?? lancamento.fornecedor_telefone}
                      </Field>
                    )}
                    {lancamento.cliente_email && (
                      <Field icon={FileText} label="E-mail">
                        {lancamento.cliente_email}
                      </Field>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Venda vinculada */}
            {temVenda && (
              <>
                <Separator />
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Venda vinculada
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field icon={ShoppingCart} label="Número">
                      {lancamento.venda_numero ?? "—"}
                    </Field>
                    <Field icon={Calendar} label="Data">
                      {formatDate(lancamento.venda_data ?? null)}
                    </Field>
                    <Field icon={Wallet} label="Total">
                      {formatBRL(Number(lancamento.venda_total ?? 0))}
                    </Field>
                  </div>
                </div>
              </>
            )}

            {/* Histórico de pagamentos */}
            {pagamentos.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <History className="h-3.5 w-3.5" />
                    Histórico de pagamentos ({pagamentos.length})
                  </p>
                  <div className="space-y-1.5 rounded-md border">
                    {pagamentos.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between gap-2 border-b px-3 py-2 text-sm last:border-0"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">
                            {formatDate(p.data_pagamento)}
                            {p.forma_pagamento && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                {p.forma_pagamento}
                              </span>
                            )}
                          </p>
                          {p.observacao && (
                            <p className="truncate text-xs text-muted-foreground">{p.observacao}</p>
                          )}
                        </div>
                        <p className="font-mono font-semibold tabular-nums text-success">
                          {formatBRL(Number(p.valor))}
                        </p>
                        {!jaResolvido && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:bg-destructive/10"
                            onClick={() => {
                              if (confirm("Remover este pagamento?")) removerPagamento.mutate(p.id);
                            }}
                            disabled={removerPagamento.isPending}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Auditoria iFood */}
            {temAuditoriaRepasse && (
              <>
                <Separator />
                <div className="rounded-md border border-success/30 bg-success/5 p-3">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-success">
                    <Receipt className="h-3.5 w-3.5" />
                    Repasse iFood conciliado
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Conciliado em</p>
                      <p className="font-medium">
                        {lancamento.conciliado_em
                          ? new Date(lancamento.conciliado_em).toLocaleString("pt-BR")
                          : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Valor recebido</p>
                      <p className="font-mono font-semibold tabular-nums">
                        {formatBRL(Number(lancamento.valor_repasse ?? 0))}
                      </p>
                    </div>
                    {Number(lancamento.taxa_repasse ?? 0) > 0 && (
                      <div>
                        <p className="text-muted-foreground">Taxa iFood</p>
                        <p className="font-mono font-semibold tabular-nums text-warning">
                          {formatBRL(Number(lancamento.taxa_repasse))}
                        </p>
                      </div>
                    )}
                    {lancamento.numero_repasse && (
                      <div>
                        <p className="text-muted-foreground">Nº do repasse</p>
                        <p className="font-medium">{lancamento.numero_repasse}</p>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {lancamento.observacoes && (
              <>
                <Separator />
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Observações
                  </p>
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
              disabled={cancelarTitulo.isPending}
            >
              Fechar
            </Button>
            <div className="flex flex-col gap-2 sm:flex-row">
              {!jaResolvido && (
                <Button
                  variant="outline"
                  onClick={() => {
                    if (confirm("Cancelar este título?")) cancelarTitulo.mutate();
                  }}
                  disabled={cancelarTitulo.isPending}
                  className="gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <XCircle className="h-4 w-4" />
                  Cancelar título
                </Button>
              )}
              {jaResolvido && lancamento.status !== "cancelado" && (
                <Button
                  variant="outline"
                  onClick={() => reabrirTitulo.mutate()}
                  disabled={reabrirTitulo.isPending}
                  className="gap-1.5"
                >
                  Reabrir
                </Button>
              )}
              {!jaResolvido && isIfoodPendente && (
                <Button
                  onClick={() => setConciliarOpen(true)}
                  className="gap-1.5 bg-success text-success-foreground hover:bg-success/90"
                >
                  <Receipt className="h-4 w-4" />
                  Conciliar iFood
                </Button>
              )}
              {!jaResolvido && !isIfoodPendente && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setPagamentoModoTotal(false);
                      setPagamentoOpen(true);
                    }}
                    className="gap-1.5"
                  >
                    <HandCoins className="h-4 w-4" />
                    Pagamento parcial
                    <kbd className="ml-1 rounded bg-muted px-1.5 text-[10px]">P</kbd>
                  </Button>
                  <Button
                    onClick={() => {
                      setPagamentoModoTotal(true);
                      setPagamentoOpen(true);
                    }}
                    className="gap-1.5 bg-success text-success-foreground hover:bg-success/90"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {isPagar ? "Marcar como pago" : "Marcar como recebido"}
                    <kbd className="ml-1 rounded bg-background/20 px-1.5 text-[10px]">B</kbd>
                  </Button>
                </>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConciliarIfoodDialog
        open={conciliarOpen}
        onOpenChange={setConciliarOpen}
        mode="individual"
        lancamentoId={lancamento.id}
        valorVenda={Number(lancamento.valor)}
        descricaoVenda={lancamento.descricao}
      />

      <RegistrarPagamentoDialog
        open={pagamentoOpen}
        onOpenChange={setPagamentoOpen}
        lancamentoId={lancamento.id}
        ownerId=""
        saldoRestante={saldoRestante}
        valorTotal={valorTotal}
        descricao={lancamento.descricao}
        tipo={lancamento.tipo}
        modoTotal={pagamentoModoTotal}
      />
    </>
  );
}
