import { useRef, useState } from "react";
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
  Pencil,
  MessageCircle,
  Copy,
  Loader2,
  AlertTriangle,
  Printer,
  Send,
} from "lucide-react";
import { gerarPixCopiaCola } from "@/lib/pix";
import {
  type AcaoHistoricoCobranca,
  type CanalHistoricoCobranca,
  abrirConversaWhatsApp,
  copiarCodigoPix,
  criarCachePix,
  criarEscopoHistoricoCobranca,
  lerMetadadosHistoricoCobranca,
  montarMensagemCobrancaAmigavel,
  montarMensagemCobrancaAtraso,
  montarMensagemPixWhatsApp,
  montarMetadadosHistoricoCobranca,
  normalizarTelefoneWhatsApp,
  resolverNomeEmpresa,
  tituloEstaVencido,
} from "@/lib/whatsappCobranca";
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
import { formatDateBR, formatDateTimeBR } from "@/lib/date-format";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useVendaDetalhe, type VendaDetalhe } from "@/hooks/useVendas";
import { useConfigEmpresa } from "@/hooks/useConfigEmpresa";
import { useEmpresaAtual } from "@/hooks/useEmpresa";
import { imprimirCupom } from "@/lib/cupom-print";
import type { CupomData } from "@/lib/cupom";
import { RegistrarPagamentoDialog } from "./RegistrarPagamentoDialog";
import { LancamentoFormDialog } from "./LancamentoFormDialog";

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
  parcela_numero?: number | null;
  parcela_total?: number | null;
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
  const [pagamentoOpen, setPagamentoOpen] = useState(false);
  const [pagamentoModoTotal, setPagamentoModoTotal] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [imprimindo, setImprimindo] = useState(false);
  const { data: empresa } = useConfigEmpresa();
  const { empresaAtual } = useEmpresaAtual();

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

  // Resolve o vínculo pela FK canônica. Para títulos antigos cuja FK não foi
  // gravada, recupera primeiro o lançamento no banco e só então usa o número
  // exato da venda, sempre limitado ao mesmo owner.
  const vendaResolvida = useQuery({
    queryKey: ["lancamento_venda_resolvida", lancamento?.id, lancamento?.venda_id, lancamento?.venda_numero],
    enabled: open && !!lancamento?.id && !!(lancamento?.venda_id || lancamento?.venda_numero || lancamento?.numero_documento),
    queryFn: async (): Promise<string | null> => {
      if (!lancamento) return null;
      if (lancamento.venda_id) return lancamento.venda_id;
      const { data: lancamentoDb, error: lancamentoError } = await supabase
        .from("financeiro_lancamentos")
        .select("venda_id, numero_documento, descricao, owner_id")
        .eq("id", lancamento.id)
        .single();
      if (lancamentoError) throw lancamentoError;
      if (lancamentoDb.venda_id) return lancamentoDb.venda_id;

      const candidatos = [
        lancamento.venda_numero,
        lancamento.numero_documento,
        lancamentoDb.numero_documento,
        lancamento.descricao.match(/\bVND-\d+\b/i)?.[0],
        lancamentoDb.descricao.match(/\bVND-\d+\b/i)?.[0],
      ]
        .filter((numero): numero is string => !!numero && /^VND-\d+$/i.test(numero.trim()))
        .map((numero) => numero.trim().toUpperCase());
      const numeroVenda = [...new Set(candidatos)][0];
      if (!numeroVenda || !lancamentoDb.owner_id) return null;
      const { data: venda, error: vendaError } = await supabase
        .from("vendas")
        .select("id")
        .eq("numero", numeroVenda)
        .eq("owner_id", lancamentoDb.owner_id)
        .maybeSingle();
      if (vendaError) throw vendaError;
      return venda?.id ?? null;
    },
  });

  const vendaIdResolvida = lancamento?.venda_id ?? vendaResolvida.data ?? null;
  const vendaDetalhe = useVendaDetalhe(open && vendaIdResolvida ? vendaIdResolvida : null);

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
          setPagamentoModoTotal(false);
          setPagamentoOpen(true);
        },
      },
      {
        key: "b",
        handler: () => {
          if (!lancamento) return;
          if (jaResolvido) return;
          setPagamentoModoTotal(true);
          setPagamentoOpen(true);
        },
      },
    ],
    { enabled: open && !pagamentoOpen, scope: "modal" },
  );

  if (!lancamento) return null;
  const info = statusInfo(lancamento);
  const isPagar = lancamento.tipo === "pagar";
  const totalPago = Number(lancamento.valor_pago ?? 0);
  const valorTotal = Number(lancamento.valor);
  const saldoRestante = Math.max(0, valorTotal - totalPago);
  const numeroParcela = Number(lancamento.parcela_numero) || 1;
  const totalParcelas = Number(lancamento.parcela_total) || 1;
  const jaResolvido =
    lancamento.status === "pago" ||
    lancamento.status === "recebido" ||
    lancamento.status === "cancelado";
  const temAuditoriaRepasse = !!lancamento.conciliado_em;
  const temCliente = !!(lancamento.cliente_nome || lancamento.cliente_documento);
  const temVenda = !!(lancamento.venda_id || lancamento.venda_numero);
  // Edição/Exclusão só fazem sentido em títulos avulsos sem baixa.
  // O banco também bloqueia — aqui escondemos para UX limpa.
  const podeEditar = !jaResolvido && !temVenda && totalPago === 0;
  const podeExcluir =
    !temVenda &&
    totalPago === 0 &&
    (lancamento.status === "pendente" || lancamento.status === "cancelado");

  async function handleImprimir() {
    if (!lancamento) return;
    const venda = vendaDetalhe.data;
    if (!venda) {
      toast.error("Não foi possível carregar os dados da venda para impressão.");
      return;
    }
    const statusCupom = saldoRestante <= 0 ? "pago" : totalPago > 0 ? "parcial" : "pendente";
    const cupom: CupomData = {
      titulo: "COMPROVANTE DE VENDA FIADO",
      numero: lancamento.venda_numero ?? venda.numero,
      data: new Date(lancamento.venda_data ?? venda.data_finalizacao ?? venda.data_emissao),
      impressoEm: new Date(),
      cliente: lancamento.cliente_nome ? { nome: lancamento.cliente_nome, documento: lancamento.cliente_documento, telefone: lancamento.cliente_telefone } : null,
      itens: venda.itens.map((item) => ({
        descricao: [item.produto_nome ?? item.descricao ?? "Produto", item.variacao_nome].filter(Boolean).join(" - "),
        sku: item.sku,
        quantidade: item.quantidade,
        unidade: item.unidade,
        preco_unitario: item.preco_unitario,
        desconto: item.desconto,
        total: item.total,
      })),
      subtotal: valorTotal,
      desconto: 0,
      outros: 0,
      frete: 0,
      total: valorTotal,
      totalItens: venda.itens.reduce((total, item) => total + item.quantidade, 0),
      forma: "fiado",
      status: statusCupom,
      valorPago: totalPago,
      saldoRestante,
      troco: 0,
      observacao: [
        `Telefone do cliente: ${lancamento.cliente_telefone ?? "—"}`,
        `Data da venda: ${formatDateBR(lancamento.venda_data ?? venda.data_finalizacao ?? venda.data_emissao)}`,
        `Parcela: ${numeroParcela}/${totalParcelas}`,
        `Valor da parcela: ${formatBRL(valorTotal)}`,
        `Total da venda: ${formatBRL(venda.total)}`,
        `Emissão: ${formatDateBR(lancamento.data_emissao ?? null)}`,
        `Vencimento: ${formatDateBR(lancamento.data_vencimento)}`,
        `Forma original: ${lancamento.forma_pagamento ?? "fiado"}`,
        `Status atual: ${info.label}`,
        `Acréscimos/outros: ${formatBRL(venda.outros)}`,
        `Frete: ${formatBRL(venda.frete)}`,
        `Valor já pago: ${formatBRL(totalPago)}`,
        `Saldo restante: ${formatBRL(saldoRestante)}`,
      ].join("\n"),
      mensagemRodape: saldoRestante <= 0 ? "Título quitado." : "Este comprovante não representa quitação enquanto houver saldo em aberto.",
    };
    setImprimindo(true);
    try {
      const resultado = await imprimirCupom(empresa ?? null, cupom);
      if (resultado.ok) {
        toast.success(resultado.printerName ? `Comprovante enviado para "${resultado.printerName}".` : "Impressão aberta.");
      } else if (resultado.needsPicker || resultado.noPrinters) {
        toast.error(resultado.warning ?? "Nenhuma impressora configurada. Configure a impressora de cupons em Configurações → Impressoras.");
      } else {
        toast.error(resultado.error ?? resultado.warning ?? "Não foi possível imprimir o comprovante.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível imprimir o comprovante.");
    } finally {
      setImprimindo(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-3xl lg:max-w-4xl">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center justify-between gap-3">
              <span className="truncate">{lancamento.descricao}</span>
              <StatusBadge status={info.label} tone={info.tone} />
            </DialogTitle>
            <DialogDescription>
              {isPagar ? "Conta a pagar" : "Conta a receber"} • {formatBRL(valorTotal)}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-1 py-2 pr-2">
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
                {formatDateBR(lancamento.data_vencimento)}
              </Field>
              <Field icon={Calendar} label="Emissão">
                {formatDateBR(lancamento.data_emissao ?? null)}
              </Field>
              <Field icon={CheckCircle2} label="Último pagamento">
                {formatDateBR(lancamento.data_pagamento)}
              </Field>
              {lancamento.forma_pagamento && (
                <Field icon={Wallet} label="Forma original">
                  {lancamento.forma_pagamento}
                </Field>
              )}
              <Field icon={Receipt} label="Parcela">
                {numeroParcela}/{totalParcelas}
              </Field>
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
                  {formatDateTimeBR(lancamento.created_at)}
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
                      {formatDateBR(lancamento.venda_data ?? null)}
                    </Field>
                    <Field icon={Wallet} label="Total">
                      {formatBRL(Number(lancamento.venda_total ?? 0))}
                    </Field>
                  </div>
                </div>
              </>
            )}

            {/* Histórico de pagamentos */}
            {temVenda && (
              <>
                <Separator />
                <ItensVendaSection
                  venda={vendaDetalhe.data}
                  isLoading={vendaResolvida.isLoading || vendaDetalhe.isLoading}
                  isError={vendaResolvida.isError || vendaDetalhe.isError}
                />
              </>
            )}

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
                            {formatDateBR(p.data_pagamento)}
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

            {/* Auditoria histórica de repasse */}
            {temAuditoriaRepasse && (
              <>
                <Separator />
                <div className="rounded-md border border-success/30 bg-success/5 p-3">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-success">
                    <Receipt className="h-3.5 w-3.5" />
                    Repasse conciliado
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Conciliado em</p>
                      <p className="font-medium">
                        {formatDateTimeBR(lancamento.conciliado_em)}
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
                        <p className="text-muted-foreground">Taxa do repasse</p>
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
            {!isPagar && !jaResolvido && (
              <CobrancaActions
                key={lancamento.id}
                lancamento={lancamento}
                saldoRestante={saldoRestante}
                venda={vendaDetalhe.data}
                carregandoVenda={vendaDetalhe.isLoading}
                nomeEmpresa={resolverNomeEmpresa({
                  nomeFantasia: empresa?.nome_fantasia,
                  razaoSocial: empresa?.razao_social,
                  nomeCadastrado: empresaAtual?.nome,
                })}
                empresaId={empresaAtual?.id ?? null}
                empresaOwnerId={empresaAtual?.owner_id ?? null}
              />
            )}
          </div>

          <DialogFooter className="z-10 shrink-0 border-t border-border bg-background pt-4 flex flex-col-reverse flex-wrap gap-2 sm:flex-row sm:items-center sm:justify-between">
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
              {temVenda && (
                <Button
                  variant="outline"
                  onClick={() => void handleImprimir()}
                  disabled={imprimindo || vendaResolvida.isLoading || vendaDetalhe.isLoading}
                  className="gap-1.5"
                >
                  {imprimindo ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Printer className="h-4 w-4" />
                  )}
                  {imprimindo ? "Imprimindo..." : "Imprimir"}
                </Button>
              )}
              {!jaResolvido && (
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

function formatQuantidade(valor: number): string {
  return valor.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

function ItensVendaSection({
  venda,
  isLoading,
  isError,
}: {
  venda: VendaDetalhe | null | undefined;
  isLoading: boolean;
  isError: boolean;
}) {
  const itens = venda?.itens ?? [];

  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Receipt className="h-3.5 w-3.5" />
        Itens da venda
      </p>

      {isLoading && (
        <div className="flex items-center justify-center gap-2 rounded-md border bg-muted/20 px-3 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando itens da venda...
        </div>
      )}

      {!isLoading && isError && (
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          Nao foi possivel carregar os itens da venda vinculada.
        </div>
      )}

      {!isLoading && !isError && itens.length === 0 && (
        <div className="rounded-md border bg-muted/20 px-3 py-4 text-sm text-muted-foreground">
          Nenhum item encontrado para esta venda.
        </div>
      )}

      {!isLoading && !isError && itens.length > 0 && (
        <>
          <div className="hidden overflow-hidden rounded-md border sm:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Produto</th>
                  <th className="px-3 py-2 text-center">Qtde</th>
                  <th className="px-3 py-2 text-right">Unitario</th>
                  <th className="px-3 py-2 text-right">Desconto</th>
                  <th className="px-3 py-2 text-right">Acrescimo</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((it) => {
                  const descricao = it.produto_nome ?? it.descricao ?? "-";
                  return (
                    <tr key={it.id} className="border-t border-border/60">
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium">{descricao}</div>
                        <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                          {it.sku && <span className="font-mono">SKU {it.sku}</span>}
                          {it.unidade && <span>Unidade {it.unidade}</span>}
                        </div>
                        {it.observacoes.length > 0 && (
                          <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                            {it.observacoes.map((obs) => (
                              <p key={obs}>{obs}</p>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center align-top font-mono tabular-nums">
                        {formatQuantidade(it.quantidade)}
                      </td>
                      <td className="px-3 py-2 text-right align-top font-mono tabular-nums">
                        {formatBRL(it.preco_unitario)}
                      </td>
                      <td className="px-3 py-2 text-right align-top font-mono tabular-nums text-warning">
                        {it.desconto > 0 ? `- ${formatBRL(it.desconto)}` : "-"}
                      </td>
                      <td className="px-3 py-2 text-right align-top font-mono tabular-nums">
                        {it.acrescimo > 0 ? formatBRL(it.acrescimo) : "-"}
                      </td>
                      <td className="px-3 py-2 text-right align-top font-mono font-semibold tabular-nums">
                        {formatBRL(it.total)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 sm:hidden">
            {itens.map((it) => {
              const descricao = it.produto_nome ?? it.descricao ?? "-";
              return (
                <div key={it.id} className="rounded-md border p-3 text-sm">
                  <div className="font-medium">{descricao}</div>
                  <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Qtde</p>
                      <p className="font-mono tabular-nums">
                        {formatQuantidade(it.quantidade)} {it.unidade ?? ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-muted-foreground">Unitario</p>
                      <p className="font-mono tabular-nums">{formatBRL(it.preco_unitario)}</p>
                    </div>
                    {it.desconto > 0 && (
                      <div>
                        <p className="text-muted-foreground">Desconto</p>
                        <p className="font-mono tabular-nums text-warning">
                          - {formatBRL(it.desconto)}
                        </p>
                      </div>
                    )}
                    {it.acrescimo > 0 && (
                      <div>
                        <p className="text-muted-foreground">Acrescimo</p>
                        <p className="font-mono tabular-nums">{formatBRL(it.acrescimo)}</p>
                      </div>
                    )}
                    <div className="col-span-2 flex items-center justify-between border-t pt-2">
                      <span className="text-muted-foreground">Total</span>
                      <span className="font-mono font-semibold tabular-nums">
                        {formatBRL(it.total)}
                      </span>
                    </div>
                  </div>
                  {(it.sku || it.observacoes.length > 0) && (
                    <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                      {it.sku && <p className="font-mono">SKU {it.sku}</p>}
                      {it.observacoes.map((obs) => (
                        <p key={obs}>{obs}</p>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex justify-end">
            <div className="w-full max-w-sm space-y-1.5 rounded-md border bg-muted/20 p-3 text-sm">
              <VendaResumoRow label="Subtotal">{formatBRL(venda!.subtotal)}</VendaResumoRow>
              {venda!.desconto > 0 && (
                <VendaResumoRow label="Desconto geral">
                  <span className="text-warning">- {formatBRL(venda!.desconto)}</span>
                </VendaResumoRow>
              )}
              {venda!.outros > 0 && (
                <VendaResumoRow label="Acrescimos">{formatBRL(venda!.outros)}</VendaResumoRow>
              )}
              {venda!.frete > 0 && (
                <VendaResumoRow label="Frete">{formatBRL(venda!.frete)}</VendaResumoRow>
              )}
              <div className="flex items-center justify-between border-t border-border pt-2 font-semibold">
                <span>Total da venda</span>
                <span className="font-mono tabular-nums text-primary">
                  {formatBRL(venda!.total)}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function VendaResumoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{children}</span>
    </div>
  );
}

interface CobrancaActionsProps {
  lancamento: LancamentoDetalhe;
  saldoRestante: number;
  venda: VendaDetalhe | null | undefined;
  carregandoVenda: boolean;
  nomeEmpresa: string;
  empresaId: string | null;
  empresaOwnerId: string | null;
}

interface IntegracaoPixCobranca {
  configuracoes: Record<string, string> | null;
  empresa_id: string;
  owner_id: string;
}

interface HistoricoCobrancaRow {
  id: string;
  created_at: string;
  sent_at: string | null;
  mensagem: string;
  tipo: "antes_vencimento" | "vencimento" | "apos_vencimento" | "manual";
}

const ROTULOS_ACAO_COBRANCA: Record<AcaoHistoricoCobranca, string> = {
  cobranca_amigavel: "Cobrança amigável",
  cobranca_atraso: "Cobrança em atraso",
  pix_whatsapp: "Pix enviado",
  pix_copiado: "Pix copiado",
};

function CobrancaActions({
  lancamento,
  saldoRestante,
  venda,
  carregandoVenda,
  nomeEmpresa,
  empresaId,
  empresaOwnerId,
}: CobrancaActionsProps) {
  const qc = useQueryClient();
  const [pixCode, setPixCode] = useState<string | null>(null);
  const [abrindoWhatsApp, setAbrindoWhatsApp] = useState(false);
  const [gerandoPix, setGerandoPix] = useState(false);
  const pixCacheRef = useRef(criarCachePix());
  const abrindoWhatsAppRef = useRef(false);

  const { data: pix = null } = useQuery({
    queryKey: ["integracao_pix", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      if (!empresaId) return null;
      const { data, error } = await (supabase.from as any)("empresa_integracoes")
        .select("configuracoes, empresa_id, owner_id")
        .eq("empresa_id", empresaId)
        .eq("tipo_integracao", "pix")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as IntegracaoPixCobranca | null) ?? null;
    },
    staleTime: 30_000,
  });

  const vendaNumero = lancamento.venda_numero ?? venda?.numero ?? null;
  const valorOriginal = Number(lancamento.valor);
  const valorPago = Number(lancamento.valor_pago ?? 0);
  const tituloVencido = tituloEstaVencido(lancamento.data_vencimento);

  const { data: operadorAtual = null } = useQuery({
    queryKey: ["cobranca_operador_atual"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return null;
      const metadata = data.user.user_metadata as Record<string, unknown>;
      const nome =
        (typeof metadata.full_name === "string" && metadata.full_name.trim()) ||
        (typeof metadata.name === "string" && metadata.name.trim()) ||
        data.user.email ||
        null;
      return { id: data.user.id, nome };
    },
    staleTime: 5 * 60_000,
  });

  const historicoKey = ["cobranca_historico", empresaId, lancamento.id];
  const { data: historico = [], isLoading: carregandoHistorico } = useQuery({
    queryKey: historicoKey,
    enabled: !!empresaId && !!lancamento.id,
    queryFn: async (): Promise<HistoricoCobrancaRow[]> => {
      if (!empresaId) return [];
      const escopo = criarEscopoHistoricoCobranca(empresaId, lancamento.id);
      const { data, error } = await supabase
        .from("cobranca_whatsapp_logs")
        .select("id, created_at, sent_at, mensagem, tipo")
        .eq("empresa_id", escopo.empresaId)
        .eq("lancamento_id", escopo.lancamentoId)
        .order("created_at", { ascending: false })
        .limit(8);
      if (error) throw new Error(error.message);
      return (data ?? []) as HistoricoCobrancaRow[];
    },
    staleTime: 15_000,
  });

  const itensMensagem = venda?.itens.map((item) => ({
    nome: item.produto_nome ?? item.descricao ?? "Produto",
    variacaoNome: item.variacao_nome,
    quantidade: item.quantidade,
    valor: item.total,
  }));

  const dadosMensagem = {
    clienteNome: lancamento.cliente_nome,
    vendaNumero,
    parcelaNumero: Number(lancamento.parcela_numero) || 1,
    totalParcelas: Number(lancamento.parcela_total) || 1,
    valorOriginal,
    valorPago,
    saldoAberto: saldoRestante,
    vencimento: formatDateBR(lancamento.data_vencimento),
    itens: itensMensagem,
    nomeEmpresa,
  };

  const validarTelefone = (): string | null => {
    if (!lancamento.cliente_telefone?.trim()) {
      toast.error("Cliente sem telefone cadastrado");
      return null;
    }
    const telefone = normalizarTelefoneWhatsApp(lancamento.cliente_telefone);
    if (!telefone) {
      toast.error("O telefone do cliente é inválido. Informe DDD e número do celular.");
      return null;
    }
    return telefone;
  };

  const obterOuGerarPix = async (): Promise<string> => {
    const existente = pixCacheRef.current.obterAtual();
    if (existente) return existente;
    const configuracaoPix = pix?.configuracoes;
    if (!configuracaoPix?.chave) {
      throw new Error("Configure o Pix em Configurações → Integrações.");
    }

    setGerandoPix(true);
    try {
      const code = await pixCacheRef.current.obterOuGerar(() =>
        gerarPixCopiaCola({
          chave: configuracaoPix.chave,
          nome: configuracaoPix.nome_recebedor || "RECEBEDOR",
          cidade: configuracaoPix.cidade || "BRASIL",
          valor: saldoRestante,
          txid: lancamento.id.replace(/-/g, "").slice(0, 25),
          descricao: lancamento.descricao.slice(0, 60),
        }),
      );
      setPixCode(code);
      return code;
    } finally {
      setGerandoPix(false);
    }
  };

  const registrarHistorico = async (
    acao: AcaoHistoricoCobranca,
    canal: CanalHistoricoCobranca,
    telefone: string | null,
  ): Promise<void> => {
    if (!empresaId || !empresaOwnerId) return;
    try {
      const mensagemAuditoria = montarMetadadosHistoricoCobranca({
        acao,
        canal,
        nomeEmpresa,
        vendaNumero,
        operadorId: operadorAtual?.id,
        operadorNome: operadorAtual?.nome,
      });
      const { error } = await supabase.from("cobranca_whatsapp_logs").insert({
        empresa_id: empresaId,
        owner_id: empresaOwnerId,
        cliente_id: lancamento.cliente_id ?? null,
        lancamento_id: lancamento.id,
        telefone,
        mensagem: mensagemAuditoria,
        status: "manual",
        tipo: acao === "cobranca_atraso" && tituloVencido ? "apos_vencimento" : "manual",
        sent_at: new Date().toISOString(),
      });
      if (!error) {
        await qc.invalidateQueries({ queryKey: historicoKey });
      }
    } catch {
      // Auditoria auxiliar: nunca bloqueia a ação principal.
    }
  };

  const abrirMensagemWhatsApp = async (
    mensagem: string,
    acao: AcaoHistoricoCobranca,
  ): Promise<void> => {
    if (abrindoWhatsAppRef.current) return;
    abrindoWhatsAppRef.current = true;
    setAbrindoWhatsApp(true);
    try {
      const resultado = await abrirConversaWhatsApp({
        telefone: lancamento.cliente_telefone,
        mensagem,
      });
      if (!resultado.sucesso) {
        if (resultado.motivo === "telefone_invalido") {
          toast.error(
            lancamento.cliente_telefone?.trim()
              ? "O telefone do cliente é inválido. Informe DDD e número do celular."
              : "Cliente sem telefone cadastrado",
          );
        } else {
          toast.error(
            "Não foi possível abrir o WhatsApp. Verifique se o aplicativo está instalado.",
          );
        }
        return;
      }
      if (resultado.destino === "whatsapp_web" && resultado.fallbackUtilizado) {
        toast.info("WhatsApp Desktop não encontrado. Abrindo WhatsApp Web.");
      }
      await registrarHistorico(acao, resultado.destino, resultado.telefone);
    } finally {
      abrindoWhatsAppRef.current = false;
      setAbrindoWhatsApp(false);
    }
  };

  const enviarPixWhatsApp = async () => {
    const telefone = validarTelefone();
    if (!telefone || abrindoWhatsAppRef.current) return;
    try {
      const code = await obterOuGerarPix();
      const mensagem = montarMensagemPixWhatsApp({ ...dadosMensagem, pixCopiaCola: code });
      await abrirMensagemWhatsApp(mensagem, "pix_whatsapp");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível gerar o Pix.");
    }
  };

  const copiarPix = async () => {
    try {
      const code = await obterOuGerarPix();
      await copiarCodigoPix(code, (texto) => navigator.clipboard.writeText(texto));
      toast.success("Código Pix copiado.");
      await registrarHistorico("pix_copiado", "clipboard", null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível gerar ou copiar o Pix.",
      );
    }
  };

  const gerarPix = async () => {
    try {
      const existente = !!pixCacheRef.current.obterAtual();
      await obterOuGerarPix();
      toast.success(existente ? "Pix já estava disponível." : "Pix gerado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível gerar o Pix.");
    }
  };

  const ocupado = abrindoWhatsApp || gerandoPix || carregandoVenda;

  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Cobrança
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void abrirMensagemWhatsApp(
              montarMensagemCobrancaAmigavel(dadosMensagem),
              "cobranca_amigavel",
            )
          }
          disabled={ocupado}
          className="gap-1.5"
        >
          {abrindoWhatsApp || carregandoVenda ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MessageCircle className="h-4 w-4" />
          )}
          Cobrança amigável
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void abrirMensagemWhatsApp(
              montarMensagemCobrancaAtraso({ ...dadosMensagem, tituloVencido }),
              "cobranca_atraso",
            )
          }
          disabled={ocupado}
          className="gap-1.5"
        >
          <AlertTriangle className="h-4 w-4" /> Cobrança em atraso
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void enviarPixWhatsApp()}
          disabled={ocupado}
          className="gap-1.5"
        >
          {gerandoPix ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Enviar Pix
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void copiarPix()}
          disabled={ocupado}
          className="gap-1.5"
        >
          <Copy className="h-4 w-4" /> Copiar Pix
        </Button>
        {!pixCode && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void gerarPix()}
            disabled={ocupado}
            className="gap-1.5"
          >
            {gerandoPix ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Receipt className="h-4 w-4" />
            )}
            Gerar Pix
          </Button>
        )}
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
      <div className="mt-3 border-t border-border/70 pt-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Histórico de cobranças
        </p>
        {carregandoHistorico ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando histórico...
          </p>
        ) : historico.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma ação registrada neste título.</p>
        ) : (
          <ul className="space-y-1.5">
            {historico.map((registro) => {
              const metadados = lerMetadadosHistoricoCobranca(registro.mensagem);
              const acao =
                metadados?.acao ??
                (registro.tipo === "apos_vencimento"
                  ? "cobranca_atraso"
                  : "cobranca_amigavel");
              const canal =
                metadados?.canal === "whatsapp_desktop"
                  ? "WhatsApp Desktop"
                  : metadados?.canal === "whatsapp_web"
                    ? "WhatsApp Web"
                    : metadados?.canal === "clipboard"
                      ? "Área de transferência"
                      : null;
              return (
                <li key={registro.id} className="text-xs text-muted-foreground">
                  {formatDateTimeBR(registro.sent_at ?? registro.created_at)} —{" "}
                  {ROTULOS_ACAO_COBRANCA[acao]}
                  {canal ? ` — ${canal}` : ""}
                  {metadados?.operador_nome ? ` — ${metadados.operador_nome}` : ""}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
