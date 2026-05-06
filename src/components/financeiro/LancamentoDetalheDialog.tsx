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
  Truck,
  History,
  HandCoins,
  Trash2,
  Pencil,
  MessageCircle,
  Copy,
} from "lucide-react";
import { gerarPixCopiaCola } from "@/lib/pix";
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
import { dataClient } from "@/integrations/data";
import { formatBRL } from "@/lib/mock-data";
import { useHotkeys } from "@/hooks/useHotkeys";
import { ConciliarIfoodDialog } from "./ConciliarIfoodDialog";
import { RegistrarPagamentoDialog } from "./RegistrarPagamentoDialog";
import { LancamentoFormDialog } from "./LancamentoFormDialog";
import { CompraDetailDialog } from "@/components/compras/CompraDetailDialog";

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
  compra_id?: string | null;
  compra_numero?: string | null;
  compra_data_emissao?: string | null;
  compra_total?: number | null;
  compra_status?: string | null;
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
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
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
  const [editOpen, setEditOpen] = useState(false);
  const [compraOpen, setCompraOpen] = useState(false);

  // owner_id atual (usuário autenticado) para inserção do pagamento
  const { data: ownerId = "" } = useQuery({
    queryKey: ["auth_uid"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? "";
    },
    staleTime: 60_000,
  });

  // Carrega histórico de pagamentos do título
  const { data: pagamentos = [] } = useQuery({
    queryKey: ["lancamento_pagamentos", lancamento?.id],
    enabled: open && !!lancamento?.id,
    queryFn: async (): Promise<PagamentoHist[]> => {
      if (!lancamento?.id) return [];
      const { data, error } = await (
        supabase.from as unknown as (t: string) => {
          select: (cols: string) => {
            eq: (
              col: string,
              val: string,
            ) => {
              order: (
                col: string,
                opts?: { ascending?: boolean },
              ) => Promise<{ data: PagamentoHist[] | null; error: { message: string } | null }>;
            };
          };
        }
      )("lancamento_pagamentos")
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
      await dataClient.financeiro.cancelarLancamento({
        lancamento_id: lancamento.id,
      });
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
      // RPC reabrir_lancamento recalcula o status pelo total já pago
      // (pendente / parcial / pago / recebido), de forma autoritativa.
      await dataClient.financeiro.reabrirLancamento(lancamento.id);
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
      await dataClient.financeiro.removerPagamento(pagId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lancamento_pagamentos", lancamento?.id] });
      qc.invalidateQueries({ queryKey: ["financeiro_lancamentos"] });
      qc.invalidateQueries({ queryKey: ["financeiro_indicadores_mes"] });
      toast.success("Pagamento removido.");
    },
    onError: (e: Error) => toast.error(e.message ?? "Falha ao remover."),
  });

  // Excluir lançamento avulso (banco bloqueia se houver pagamento ou vínculo).
  const excluirLancamento = useMutation({
    mutationFn: async () => {
      if (!lancamento) return;
      await dataClient.financeiro.excluirLancamentoAvulso(lancamento.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["financeiro_lancamentos"] });
      qc.invalidateQueries({ queryKey: ["financeiro_indicadores_mes"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Lançamento excluído.");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message ?? "Não foi possível excluir."),
  });

  // Carrega FKs (categoria/cliente/fornecedor) quando precisar editar — o objeto
  // `lancamento` recebido só traz nomes, não IDs. Buscamos sob demanda.
  const { data: lancamentoFks } = useQuery({
    queryKey: ["lancamento_fks", lancamento?.id],
    enabled: open && editOpen && !!lancamento?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financeiro_lancamentos")
        .select(
          "id, tipo, descricao, valor, data_vencimento, data_emissao, categoria_id, cliente_id, fornecedor_id, numero_documento, forma_pagamento, observacoes, venda_id, compra_id",
        )
        .eq("id", lancamento!.id)
        .single();
      if (error) throw new Error(error.message);
      return data as {
        id: string;
        tipo: "receber" | "pagar";
        descricao: string;
        valor: number;
        data_vencimento: string;
        data_emissao: string | null;
        categoria_id: string | null;
        cliente_id: string | null;
        fornecedor_id: string | null;
        numero_documento: string | null;
        forma_pagamento: string | null;
        observacoes: string | null;
        venda_id: string | null;
        compra_id: string | null;
      };
    },
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
  const temCompra = !!(lancamento.compra_id || lancamento.compra_numero);
  // Edição/Exclusão só fazem sentido em títulos avulsos sem baixa.
  // O banco também bloqueia — aqui escondemos para UX limpa.
  const podeEditar = !jaResolvido && !temVenda && !temCompra && totalPago === 0;
  const podeExcluir =
    !temVenda &&
    !temCompra &&
    totalPago === 0 &&
    (lancamento.status === "pendente" || lancamento.status === "cancelado");

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto overflow-x-hidden sm:max-w-3xl lg:max-w-4xl">
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
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Valor original
                </p>
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
                        {formatDoc(lancamento.cliente_documento ?? lancamento.fornecedor_documento)}
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

            {/* Compra vinculada */}
            {temCompra && (
              <>
                <Separator />
                <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <Truck className="h-3.5 w-3.5" />
                      Compra vinculada
                    </p>
                    {lancamento.compra_id && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setCompraOpen(true)}
                        className="h-7 gap-1.5 text-xs"
                      >
                        Ver compra
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field icon={FileText} label="Número">
                      {lancamento.compra_numero ?? "—"}
                    </Field>
                    <Field icon={Calendar} label="Emissão">
                      {formatDate(lancamento.compra_data_emissao ?? null)}
                    </Field>
                    <Field icon={Wallet} label="Total">
                      {formatBRL(Number(lancamento.compra_total ?? 0))}
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

          {!isPagar && !jaResolvido && (
            <CobrancaActions lancamento={lancamento} saldoRestante={saldoRestante} />
          )}

          <DialogFooter className="flex flex-col-reverse flex-wrap gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2 sm:flex-row">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={cancelarTitulo.isPending}
              >
                Fechar
              </Button>
              {podeEditar && (
                <Button variant="outline" onClick={() => setEditOpen(true)} className="gap-1.5">
                  <Pencil className="h-4 w-4" />
                  Editar
                </Button>
              )}
              {podeExcluir && (
                <Button
                  variant="outline"
                  onClick={() => {
                    if (
                      confirm(
                        "Excluir DEFINITIVAMENTE este lançamento? Esta ação não pode ser desfeita.",
                      )
                    ) {
                      excluirLancamento.mutate();
                    }
                  }}
                  disabled={excluirLancamento.isPending}
                  className="gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                  Excluir
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 sm:flex-row">
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

      <CompraDetailDialog
        open={compraOpen}
        onOpenChange={setCompraOpen}
        compraId={lancamento.compra_id ?? null}
      />

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
        ownerId={ownerId}
        saldoRestante={saldoRestante}
        valorTotal={valorTotal}
        descricao={lancamento.descricao}
        tipo={lancamento.tipo}
        modoTotal={pagamentoModoTotal}
      />

      {/* Edição: só monta o form quando temos os IDs FK carregados, evitando
          renderizar com cliente/fornecedor/categoria zerados. */}
      {editOpen && lancamentoFks && (
        <LancamentoFormDialog
          mode="edit"
          open={editOpen}
          onOpenChange={setEditOpen}
          lancamento={{
            id: lancamentoFks.id,
            tipo: lancamentoFks.tipo,
            descricao: lancamentoFks.descricao,
            valor: Number(lancamentoFks.valor ?? 0),
            data_vencimento: lancamentoFks.data_vencimento,
            data_emissao: lancamentoFks.data_emissao,
            categoria_id: lancamentoFks.categoria_id,
            cliente_id: lancamentoFks.cliente_id,
            fornecedor_id: lancamentoFks.fornecedor_id,
            numero_documento: lancamentoFks.numero_documento,
            forma_pagamento: lancamentoFks.forma_pagamento,
            observacoes: lancamentoFks.observacoes,
          }}
          onSaved={() => {
            // O dialog de detalhe fica desatualizado; fecha pra o usuário reabrir limpo.
            onOpenChange(false);
          }}
        />
      )}
    </>
  );
}

interface CobrancaActionsProps {
  lancamento: LancamentoDetalhe;
  saldoRestante: number;
}

function CobrancaActions({ lancamento, saldoRestante }: CobrancaActionsProps) {
  const qc = useQueryClient();
  const [pixCode, setPixCode] = useState<string | null>(null);

  const { data: integracoes = [] } = useQuery({
    queryKey: ["integracoes_cobranca"],
    queryFn: async () => {
      const { data, error } = await (supabase.from as unknown as (t: string) => {
        select: (cols: string) => {
          in: (col: string, vals: string[]) => Promise<{ data: any[] | null; error: { message: string } | null }>;
        };
      })("empresa_integracoes")
        .select("tipo_integracao, status, ativo, configuracoes, empresa_id, owner_id")
        .in("tipo_integracao", ["pix", "whatsapp"]);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const pix = integracoes.find((i) => i.tipo_integracao === "pix");
  const wa = integracoes.find((i) => i.tipo_integracao === "whatsapp");

  const formatBR = (v: number) =>
    v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const buildVenc = () => {
    const d = lancamento.data_vencimento.length === 10
      ? lancamento.data_vencimento
      : lancamento.data_vencimento.slice(0, 10);
    const [y, m, day] = d.split("-");
    return `${day}/${m}/${y}`;
  };

  const gerarPix = () => {
    if (!pix?.configuracoes?.chave) {
      toast.error("Configure o Pix em Configurações → Integrações");
      return;
    }
    const code = gerarPixCopiaCola({
      chave: pix.configuracoes.chave,
      nome: pix.configuracoes.nome_recebedor || "RECEBEDOR",
      cidade: pix.configuracoes.cidade || "BRASIL",
      valor: saldoRestante,
      txid: lancamento.id.replace(/-/g, "").slice(0, 25),
      descricao: lancamento.descricao.slice(0, 60),
    });
    setPixCode(code);
    toast.success("Pix gerado");
  };

  const copiarPix = async () => {
    let code = pixCode;
    if (!code) {
      if (!pix?.configuracoes?.chave) {
        toast.error("Configure o Pix em Configurações → Integrações");
        return;
      }
      code = gerarPixCopiaCola({
        chave: pix.configuracoes.chave,
        nome: pix.configuracoes.nome_recebedor || "RECEBEDOR",
        cidade: pix.configuracoes.cidade || "BRASIL",
        valor: saldoRestante,
        txid: lancamento.id.replace(/-/g, "").slice(0, 25),
        descricao: lancamento.descricao.slice(0, 60),
      });
      setPixCode(code);
    }
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Pix copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  const cobrarWhatsApp = async () => {
    const tel = (lancamento.cliente_telefone || "").replace(/\D/g, "");
    if (!tel) {
      toast.error("Cliente sem telefone cadastrado");
      return;
    }
    const template: string =
      wa?.configuracoes?.msg_vencimento ||
      "Olá {{cliente_nome}}, sua cobrança de R$ {{valor}} vence em {{vencimento}}. Pix: {{pix_copia_cola}}";
    let pixCopia = pixCode || "";
    if (!pixCopia && pix?.configuracoes?.chave) {
      pixCopia = gerarPixCopiaCola({
        chave: pix.configuracoes.chave,
        nome: pix.configuracoes.nome_recebedor || "RECEBEDOR",
        cidade: pix.configuracoes.cidade || "BRASIL",
        valor: saldoRestante,
        txid: lancamento.id.replace(/-/g, "").slice(0, 25),
        descricao: lancamento.descricao.slice(0, 60),
      });
      setPixCode(pixCopia);
    }
    const msg = template
      .replace(/\{\{cliente_nome\}\}/g, lancamento.cliente_nome || "cliente")
      .replace(/\{\{valor\}\}/g, formatBR(saldoRestante))
      .replace(/\{\{vencimento\}\}/g, buildVenc())
      .replace(/\{\{empresa_nome\}\}/g, "")
      .replace(/\{\{pix_copia_cola\}\}/g, pixCopia || "");

    const telFull = tel.length <= 11 ? `55${tel}` : tel;
    const url = `https://wa.me/${telFull}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");

    // Registra log
    if (wa?.empresa_id) {
      try {
        await (supabase.from as any)("cobranca_whatsapp_logs").insert({
          empresa_id: wa.empresa_id,
          owner_id: wa.owner_id,
          cliente_id: lancamento.cliente_id ?? null,
          lancamento_id: lancamento.id,
          telefone: telFull,
          mensagem: msg,
          status: "manual",
          tipo: "manual",
          sent_at: new Date().toISOString(),
        });
        qc.invalidateQueries({ queryKey: ["cobranca_whatsapp_logs"] });
      } catch {
        /* silencioso */
      }
    }
  };

  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Cobrança
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={cobrarWhatsApp} className="gap-1.5">
          <MessageCircle className="h-4 w-4" /> Cobrar no WhatsApp
        </Button>
        <Button size="sm" variant="outline" onClick={gerarPix} className="gap-1.5">
          <Receipt className="h-4 w-4" /> Gerar Pix
        </Button>
        <Button size="sm" variant="outline" onClick={copiarPix} className="gap-1.5">
          <Copy className="h-4 w-4" /> Copiar Pix
        </Button>
      </div>
      {pixCode && (
        <p className="mt-2 break-all rounded border bg-background p-2 font-mono text-xs">
          {pixCode}
        </p>
      )}
      {!pix?.configuracoes?.chave && (
        <p className="mt-2 text-xs text-muted-foreground">
          Configure o Pix em Configurações → Integrações para habilitar copia e cola.
        </p>
      )}
    </div>
  );
}
