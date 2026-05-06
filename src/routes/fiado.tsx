import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  HandCoins,
  AlertTriangle,
  CalendarClock,
  Users,
  Wallet,
  TrendingUp,
  Search,
  ChevronDown,
  ChevronRight,
  MessageCircle,
  Copy,
  Receipt,
  Download,
  FileText,
  Sheet as SheetIcon,
  CheckCircle2,
  Phone,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { formatBRL } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { RequirePermission } from "@/components/auth/RequirePermission";
import { RegistrarPagamentoDialog } from "@/components/financeiro/RegistrarPagamentoDialog";
import {
  LancamentoDetalheDialog,
  type LancamentoDetalhe,
} from "@/components/financeiro/LancamentoDetalheDialog";
import { DetalheVendaDialog } from "@/components/vendas/DetalheVendaDialog";
import { exportRowsToCSV, type CsvColumn } from "@/lib/export-csv";

export const Route = createFileRoute("/fiado")({
  head: () => ({
    meta: [
      { title: "Clientes a Receber — Gestão Pro" },
      {
        name: "description",
        content: "Carteira de clientes a receber e controle de recebimentos pendentes.",
      },
    ],
  }),
  component: FiadoPage,
});

type StatusFiltro = "todos" | "vencido" | "a_vencer" | "parcial" | "pago";

interface LancamentoFiado {
  id: string;
  descricao: string;
  valor: number;
  valor_pago: number | null;
  data_vencimento: string;
  data_emissao: string | null;
  data_pagamento: string | null;
  status: string;
  observacoes: string | null;
  cliente_id: string | null;
  venda_id: string | null;
  forma_pagamento: string | null;
  cliente: {
    id: string;
    nome: string;
    documento: string | null;
    telefone: string | null;
    celular: string | null;
    email: string | null;
  } | null;
  venda: {
    id: string;
    numero: string | null;
    data_finalizacao: string | null;
    total: number | null;
  } | null;
}

interface ClienteAgrupado {
  cliente_id: string;
  nome: string;
  documento: string | null;
  telefone: string | null;
  email: string | null;
  totalAberto: number;
  totalVencido: number;
  totalAVencer: number;
  totalPago: number;
  totalGeral: number;
  qtdTitulos: number;
  ultimaCompra: string | null;
  ultimoPagamento: string | null;
  status: "vencido" | "parcial" | "em_aberto" | "pago";
  lancamentos: LancamentoFiado[];
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  const onlyDate = d.length === 10 ? d : d.slice(0, 10);
  const [y, m, day] = onlyDate.split("-");
  if (!y || !m || !day) return d;
  return `${day}/${m}/${y}`;
}

function isVencido(dataVenc: string, status: string): boolean {
  if (status === "pago" || status === "recebido" || status === "cancelado") return false;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return new Date(dataVenc + "T00:00:00") < hoje;
}

function statusLanc(l: LancamentoFiado): { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" } {
  if (l.status === "pago" || l.status === "recebido") return { label: "Pago", tone: "success" };
  if (l.status === "cancelado") return { label: "Cancelado", tone: "neutral" };
  if (Number(l.valor_pago ?? 0) > 0) {
    if (isVencido(l.data_vencimento, l.status)) return { label: "Vencido", tone: "danger" };
    return { label: "Parcial", tone: "info" };
  }
  if (isVencido(l.data_vencimento, l.status)) return { label: "Vencido", tone: "danger" };
  return { label: "Em aberto", tone: "warning" };
}

function onlyDigits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

function FiadoPage() {
  return (
    <RequirePermission permission="financeiro">
      <FiadoContent />
    </RequirePermission>
  );
}

function FiadoContent() {
  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState<StatusFiltro>("todos");
  const [expandidos, setExpandidos] = useState<Record<string, boolean>>({});
  const [pagamentoOpen, setPagamentoOpen] = useState(false);
  const [pagamentoModoTotal, setPagamentoModoTotal] = useState(false);
  const [lancSelecionado, setLancSelecionado] = useState<LancamentoFiado | null>(null);
  const [detalheOpen, setDetalheOpen] = useState(false);
  const [detalheLanc, setDetalheLanc] = useState<LancamentoDetalhe | null>(null);
  const [vendaOpen, setVendaOpen] = useState(false);
  const [vendaIdSel, setVendaIdSel] = useState<string | null>(null);

  const { data: ownerId = "" } = useQuery({
    queryKey: ["auth_uid"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? "";
    },
    staleTime: 60_000,
  });

  const { data: lancamentos = [], isLoading } = useQuery({
    queryKey: ["fiado_lancamentos"],
    staleTime: 30_000,
    queryFn: async (): Promise<LancamentoFiado[]> => {
      const { data, error } = await supabase
        .from("financeiro_lancamentos")
        .select(
          `id, descricao, valor, valor_pago, data_vencimento, data_emissao, data_pagamento,
           status, observacoes, cliente_id, venda_id, forma_pagamento,
           cliente:clientes(id, nome, documento, telefone, celular, email),
           venda:vendas(id, numero, data_finalizacao, total)`
        )
        .eq("tipo", "receber")
        .eq("forma_pagamento", "fiado")
        .neq("status", "cancelado")
        .order("data_vencimento", { ascending: true })
        .limit(5000);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as LancamentoFiado[];
    },
  });

  // KPIs
  const kpis = useMemo(() => {
    const hojeStr = new Date().toISOString().slice(0, 10);
    const mesAtual = hojeStr.slice(0, 7);
    let totalFiado = 0;
    let totalVencido = 0;
    let totalAVencer = 0;
    let recebidoHoje = 0;
    let recebidoMes = 0;
    const clientesComDivida = new Set<string>();
    for (const l of lancamentos) {
      const aberto = Math.max(0, Number(l.valor) - Number(l.valor_pago ?? 0));
      const pagoTotal = Number(l.valor_pago ?? 0);
      if (aberto > 0 && l.status !== "pago" && l.status !== "recebido") {
        totalFiado += aberto;
        if (isVencido(l.data_vencimento, l.status)) totalVencido += aberto;
        else totalAVencer += aberto;
        if (l.cliente_id) clientesComDivida.add(l.cliente_id);
      }
      if (l.data_pagamento && pagoTotal > 0) {
        if (l.data_pagamento === hojeStr) recebidoHoje += pagoTotal;
        if (l.data_pagamento.startsWith(mesAtual)) recebidoMes += pagoTotal;
      }
    }
    return {
      totalFiado,
      totalVencido,
      totalAVencer,
      qtdClientes: clientesComDivida.size,
      recebidoHoje,
      recebidoMes,
    };
  }, [lancamentos]);

  // Agrupamento por cliente
  const clientesAgrupados = useMemo<ClienteAgrupado[]>(() => {
    const map = new Map<string, ClienteAgrupado>();
    for (const l of lancamentos) {
      const cid = l.cliente_id ?? "__sem_cliente__";
      const nome = l.cliente?.nome ?? "Cliente não informado";
      let g = map.get(cid);
      if (!g) {
        g = {
          cliente_id: cid,
          nome,
          documento: l.cliente?.documento ?? null,
          telefone: l.cliente?.celular ?? l.cliente?.telefone ?? null,
          email: l.cliente?.email ?? null,
          totalAberto: 0,
          totalVencido: 0,
          totalAVencer: 0,
          totalPago: 0,
          totalGeral: 0,
          qtdTitulos: 0,
          ultimaCompra: null,
          ultimoPagamento: null,
          status: "em_aberto",
          lancamentos: [],
        };
        map.set(cid, g);
      }
      const aberto = Math.max(0, Number(l.valor) - Number(l.valor_pago ?? 0));
      g.totalGeral += Number(l.valor);
      g.totalPago += Number(l.valor_pago ?? 0);
      if (l.status !== "pago" && l.status !== "recebido") {
        g.totalAberto += aberto;
        if (isVencido(l.data_vencimento, l.status)) g.totalVencido += aberto;
        else g.totalAVencer += aberto;
      }
      g.qtdTitulos += 1;
      const dataCompra = l.venda?.data_finalizacao ?? l.data_emissao;
      if (dataCompra && (!g.ultimaCompra || dataCompra > g.ultimaCompra)) {
        g.ultimaCompra = dataCompra.slice(0, 10);
      }
      if (l.data_pagamento && (!g.ultimoPagamento || l.data_pagamento > g.ultimoPagamento)) {
        g.ultimoPagamento = l.data_pagamento;
      }
      g.lancamentos.push(l);
    }
    const arr = Array.from(map.values()).map((g) => {
      let status: ClienteAgrupado["status"] = "pago";
      if (g.totalAberto > 0) {
        if (g.totalVencido > 0) status = "vencido";
        else if (g.totalPago > 0) status = "parcial";
        else status = "em_aberto";
      }
      return { ...g, status };
    });
    return arr.sort((a, b) => b.totalAberto - a.totalAberto);
  }, [lancamentos]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const qDigits = onlyDigits(busca);
    return clientesAgrupados.filter((c) => {
      if (statusFiltro !== "todos") {
        if (statusFiltro === "vencido" && c.status !== "vencido") return false;
        if (statusFiltro === "a_vencer" && c.totalAVencer <= 0) return false;
        if (statusFiltro === "parcial" && c.status !== "parcial") return false;
        if (statusFiltro === "pago" && c.totalAberto > 0) return false;
      }
      if (!q) return true;
      if (c.nome.toLowerCase().includes(q)) return true;
      if (c.documento && onlyDigits(c.documento).includes(qDigits)) return true;
      if (c.telefone && qDigits && onlyDigits(c.telefone).includes(qDigits)) return true;
      if (c.email && c.email.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [clientesAgrupados, busca, statusFiltro]);

  function toggleExpandido(cid: string) {
    setExpandidos((prev) => ({ ...prev, [cid]: !prev[cid] }));
  }

  function abrirPagamento(l: LancamentoFiado, modoTotal: boolean) {
    setLancSelecionado(l);
    setPagamentoModoTotal(modoTotal);
    setPagamentoOpen(true);
  }

  function abrirDetalheLanc(l: LancamentoFiado) {
    setDetalheLanc({
      id: l.id,
      descricao: l.descricao,
      valor: Number(l.valor),
      valor_pago: Number(l.valor_pago ?? 0),
      data_vencimento: l.data_vencimento,
      data_pagamento: l.data_pagamento,
      data_emissao: l.data_emissao,
      tipo: "receber",
      status: l.status as LancamentoDetalhe["status"],
      observacoes: l.observacoes,
      cliente_id: l.cliente?.id ?? null,
      cliente_nome: l.cliente?.nome ?? null,
      cliente_documento: l.cliente?.documento ?? null,
      cliente_telefone: l.cliente?.celular ?? l.cliente?.telefone ?? null,
      cliente_email: l.cliente?.email ?? null,
      venda_id: l.venda?.id ?? l.venda_id,
      venda_numero: l.venda?.numero ?? null,
      venda_data: l.venda?.data_finalizacao ?? null,
      venda_total: l.venda?.total ?? null,
      forma_pagamento: l.forma_pagamento,
    });
    setDetalheOpen(true);
  }

  function abrirVenda(vendaId: string | null | undefined) {
    if (!vendaId) {
      toast.error("Venda não vinculada a este título.");
      return;
    }
    setVendaIdSel(vendaId);
    setVendaOpen(true);
  }

  function whatsapp(c: ClienteAgrupado) {
    const tel = onlyDigits(c.telefone);
    if (!tel) {
      toast.error("Cliente sem telefone cadastrado.");
      return;
    }
    const num = tel.length === 11 || tel.length === 10 ? `55${tel}` : tel;
    const msg = encodeURIComponent(
      `Olá ${c.nome}, identificamos um saldo em aberto de ${formatBRL(c.totalAberto)}. ` +
        `Podemos confirmar o pagamento?`,
    );
    window.open(`https://wa.me/${num}?text=${msg}`, "_blank", "noopener,noreferrer");
  }

  async function copiarTel(c: ClienteAgrupado) {
    if (!c.telefone) return toast.error("Sem telefone.");
    try {
      await navigator.clipboard.writeText(c.telefone);
      toast.success("Telefone copiado.");
    } catch {
      toast.error("Falha ao copiar.");
    }
  }

  async function exportarCSV() {
    const cols: CsvColumn<ClienteAgrupado>[] = [
      { header: "Cliente", accessor: (r) => r.nome },
      { header: "Documento", accessor: (r) => r.documento ?? "" },
      { header: "Telefone", accessor: (r) => r.telefone ?? "" },
      { header: "Total em aberto", accessor: (r) => r.totalAberto, type: "currency" },
      { header: "Vencido", accessor: (r) => r.totalVencido, type: "currency" },
      { header: "A vencer", accessor: (r) => r.totalAVencer, type: "currency" },
      { header: "Total pago", accessor: (r) => r.totalPago, type: "currency" },
      { header: "Qtd títulos", accessor: (r) => r.qtdTitulos, type: "integer" },
      { header: "Última compra", accessor: (r) => r.ultimaCompra ?? "" },
      { header: "Status", accessor: (r) => r.status },
    ];
    await exportRowsToCSV("clientes_a_receber", filtrados, cols, {
      relatorio: "Clientes a receber",
    });
    toast.success("CSV gerado.");
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        title="Clientes a Receber"
        description="Carteira de recebimentos pendentes."
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="mr-2 h-4 w-4" /> Exportar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportarCSV}>
                <SheetIcon className="mr-2 h-4 w-4" /> CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.print()}>
                <FileText className="mr-2 h-4 w-4" /> Imprimir / PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total a receber" value={formatBRL(kpis.totalFiado)} icon={HandCoins} iconTone="warning" />
        <StatCard label="Vencido" value={formatBRL(kpis.totalVencido)} icon={AlertTriangle} iconTone="danger" />
        <StatCard label="A vencer" value={formatBRL(kpis.totalAVencer)} icon={CalendarClock} iconTone="info" />
        <StatCard label="Clientes em aberto" value={String(kpis.qtdClientes)} icon={Users} iconTone="primary" />
        <StatCard label="Recebido hoje" value={formatBRL(kpis.recebidoHoje)} icon={Wallet} iconTone="success" />
        <StatCard label="Recebido no mês" value={formatBRL(kpis.recebidoMes)} icon={TrendingUp} iconTone="success" />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar cliente por nome, CPF/CNPJ ou telefone"
              className="pl-9"
            />
          </div>
          <Select value={statusFiltro} onValueChange={(v) => setStatusFiltro(v as StatusFiltro)}>
            <SelectTrigger className="md:w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os status</SelectItem>
              <SelectItem value="vencido">Vencidos</SelectItem>
              <SelectItem value="a_vencer">A vencer</SelectItem>
              <SelectItem value="parcial">Parcial</SelectItem>
              <SelectItem value="pago">Quitados</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {isLoading ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Carregando…</CardContent></Card>
        ) : filtrados.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <HandCoins className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Nenhum cliente a receber encontrado.</p>
            </CardContent>
          </Card>
        ) : (
          filtrados.map((c) => (
            <ClienteCard
              key={c.cliente_id}
              cliente={c}
              expandido={!!expandidos[c.cliente_id]}
              onToggle={() => toggleExpandido(c.cliente_id)}
              onWhatsapp={() => whatsapp(c)}
              onCopiarTel={() => copiarTel(c)}
              onPagamento={(l, total) => abrirPagamento(l, total)}
              onAbrirVenda={(id) => abrirVenda(id)}
              onAbrirDetalhe={(l) => abrirDetalheLanc(l)}
            />
          ))
        )}
      </div>

      {lancSelecionado && ownerId && (
        <RegistrarPagamentoDialog
          open={pagamentoOpen}
          onOpenChange={setPagamentoOpen}
          lancamentoId={lancSelecionado.id}
          ownerId={ownerId}
          saldoRestante={Math.max(0, Number(lancSelecionado.valor) - Number(lancSelecionado.valor_pago ?? 0))}
          valorTotal={Number(lancSelecionado.valor)}
          descricao={lancSelecionado.descricao}
          tipo="receber"
          modoTotal={pagamentoModoTotal}
        />
      )}

      <LancamentoDetalheDialog
        open={detalheOpen}
        onOpenChange={setDetalheOpen}
        lancamento={detalheLanc}
      />

      <DetalheVendaDialog open={vendaOpen} onOpenChange={setVendaOpen} vendaId={vendaIdSel} />
    </div>
  );
}

interface ClienteCardProps {
  cliente: ClienteAgrupado;
  expandido: boolean;
  onToggle: () => void;
  onWhatsapp: () => void;
  onCopiarTel: () => void;
  onPagamento: (l: LancamentoFiado, total: boolean) => void;
  onAbrirVenda: (id: string | null) => void;
  onAbrirDetalhe: (l: LancamentoFiado) => void;
}

function ClienteCard({
  cliente,
  expandido,
  onToggle,
  onWhatsapp,
  onCopiarTel,
  onPagamento,
  onAbrirVenda,
  onAbrirDetalhe,
}: ClienteCardProps) {
  const statusBadge = (() => {
    if (cliente.status === "vencido") return { label: "Em atraso", tone: "danger" as const };
    if (cliente.status === "parcial") return { label: "Parcial", tone: "info" as const };
    if (cliente.status === "pago") return { label: "Quitado", tone: "success" as const };
    return { label: "Em aberto", tone: "warning" as const };
  })();

  return (
    <Collapsible open={expandido} onOpenChange={onToggle}>
      <Card className={cn(cliente.status === "vencido" && "border-destructive/40")}>
        <CardContent className="p-0">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/40"
            >
              {expandido ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-semibold">{cliente.nome}</p>
                  <StatusBadge status={statusBadge.label} tone={statusBadge.tone} />
                  <Badge variant="outline" className="text-xs">{cliente.qtdTitulos} título(s)</Badge>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-4">
                  <span>Em aberto: <span className="font-mono font-semibold text-foreground">{formatBRL(cliente.totalAberto)}</span></span>
                  <span className="text-destructive">Vencido: <span className="font-mono">{formatBRL(cliente.totalVencido)}</span></span>
                  <span>A vencer: <span className="font-mono">{formatBRL(cliente.totalAVencer)}</span></span>
                  <span>Última compra: {formatDate(cliente.ultimaCompra)}</span>
                </div>
              </div>
              <div className="hidden items-center gap-1 sm:flex" onClick={(e) => e.stopPropagation()}>
                {cliente.telefone && (
                  <>
                    <Button size="icon" variant="ghost" onClick={onWhatsapp} title="Enviar WhatsApp">
                      <MessageCircle className="h-4 w-4 text-success" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={onCopiarTel} title="Copiar telefone">
                      <Copy className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="border-t bg-muted/20 p-3 sm:p-4">
              {cliente.telefone && (
                <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:hidden">
                  <Phone className="h-3.5 w-3.5" /> {cliente.telefone}
                  <Button size="sm" variant="outline" onClick={onWhatsapp}>
                    <MessageCircle className="mr-1 h-3.5 w-3.5" /> WhatsApp
                  </Button>
                  <Button size="sm" variant="outline" onClick={onCopiarTel}>
                    <Copy className="mr-1 h-3.5 w-3.5" /> Copiar
                  </Button>
                </div>
              )}

              {/* Tabela desktop */}
              <div className="hidden overflow-x-auto rounded-md border bg-background md:block">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Venda</th>
                      <th className="px-3 py-2 text-left">Vencimento</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-3 py-2 text-right">Pago</th>
                      <th className="px-3 py-2 text-right">Restante</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cliente.lancamentos.map((l) => {
                      const restante = Math.max(0, Number(l.valor) - Number(l.valor_pago ?? 0));
                      const st = statusLanc(l);
                      const quitado = l.status === "pago" || l.status === "recebido";
                      return (
                        <tr key={l.id} className="border-t">
                          <td className="px-3 py-2">
                            {l.venda?.numero ? (
                              <button className="text-primary hover:underline" onClick={() => onAbrirVenda(l.venda?.id ?? l.venda_id)}>
                                #{l.venda.numero}
                              </button>
                            ) : (
                              <span className="text-muted-foreground">{l.descricao}</span>
                            )}
                          </td>
                          <td className="px-3 py-2">{formatDate(l.data_vencimento)}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatBRL(Number(l.valor))}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatBRL(Number(l.valor_pago ?? 0))}</td>
                          <td className="px-3 py-2 text-right font-mono font-semibold">{formatBRL(restante)}</td>
                          <td className="px-3 py-2"><StatusBadge status={st.label} tone={st.tone} /></td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex justify-end gap-1">
                              {!quitado && (
                                <>
                                  <Button size="sm" variant="default" onClick={() => onPagamento(l, true)} title="Baixa total">
                                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Baixa
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={() => onPagamento(l, false)} title="Pagamento parcial">
                                    Parcial
                                  </Button>
                                </>
                              )}
                              <Button size="sm" variant="ghost" onClick={() => onAbrirDetalhe(l)} title="Detalhes">
                                <Receipt className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Cards mobile */}
              <div className="space-y-2 md:hidden">
                {cliente.lancamentos.map((l) => {
                  const restante = Math.max(0, Number(l.valor) - Number(l.valor_pago ?? 0));
                  const st = statusLanc(l);
                  const quitado = l.status === "pago" || l.status === "recebido";
                  return (
                    <Card key={l.id}>
                      <CardContent className="space-y-2 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium">
                            {l.venda?.numero ? `Venda #${l.venda.numero}` : l.descricao}
                          </p>
                          <StatusBadge status={st.label} tone={st.tone} />
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <p className="text-muted-foreground">Vencimento</p>
                            <p className="font-medium">{formatDate(l.data_vencimento)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Total</p>
                            <p className="font-mono">{formatBRL(Number(l.valor))}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Restante</p>
                            <p className="font-mono font-semibold">{formatBRL(restante)}</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 pt-1">
                          {!quitado && (
                            <>
                              <Button size="sm" onClick={() => onPagamento(l, true)} className="flex-1">
                                <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Baixa total
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => onPagamento(l, false)} className="flex-1">
                                Parcial
                              </Button>
                            </>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => onAbrirDetalhe(l)}>
                            <Receipt className="mr-1 h-3.5 w-3.5" /> Detalhes
                          </Button>
                          {l.venda?.id && (
                            <Button size="sm" variant="ghost" onClick={() => onAbrirVenda(l.venda?.id ?? null)}>
                              Abrir venda
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>Total geral: <span className="font-mono">{formatBRL(cliente.totalGeral)}</span></span>
                <span>Total pago: <span className="font-mono">{formatBRL(cliente.totalPago)}</span></span>
                {cliente.ultimoPagamento && (
                  <span>Último pagamento: {formatDate(cliente.ultimoPagamento)}</span>
                )}
              </div>
            </div>
          </CollapsibleContent>
        </CardContent>
      </Card>
    </Collapsible>
  );
}
