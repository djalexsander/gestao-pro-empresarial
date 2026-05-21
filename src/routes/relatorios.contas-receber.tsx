import { dataClient } from "@/integrations/data";
import { fetchContasReceberAudit } from "@/integrations/data/relatorios-audit";
import { useEmpresaAtual } from "@/hooks/useEmpresa";
import { AuditoriaCard } from "@/components/relatorios/AuditoriaCard";
import type { RelatorioAuditoria } from "@/lib/relatorios/audit";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Download,
  Filter,
  HandCoins,
  Loader2,
  RotateCcw,
  Wallet,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ModuloGate } from "@/components/saas/ModuloGate";
import { formatBRL } from "@/lib/mock-data";
import { exportRowsToCSV, type CsvColumn } from "@/lib/export-csv";
import { LancamentoDetalheDialog, type LancamentoDetalhe } from "@/components/financeiro/LancamentoDetalheDialog";
import { cn } from "@/lib/utils";
import { formatarDocumento } from "@/lib/documento";

export const Route = createFileRoute("/relatorios/contas-receber")({
  head: () => ({
    meta: [
      { title: "Contas a receber — Relatórios" },
      {
        name: "description",
        content:
          "Relatório de contas a receber por cliente, período e mês com saldo restante.",
      },
    ],
  }),
  component: () => (
    <ModuloGate chave="relatorios" titulo="Relatório de contas a receber">
      <Conteudo />
    </ModuloGate>
  ),
});

type PeriodoPreset = "30d" | "mes" | "mes_anterior" | "ano" | "personalizado";
type StatusFiltro = "todos" | "abertos" | "pendente" | "parcial" | "vencido" | "pago" | "cancelado";

interface Row {
  id: string;
  descricao: string;
  valor: number;
  valor_pago: number;
  saldo: number;
  data_emissao: string | null;
  data_vencimento: string;
  data_pagamento: string | null;
  status: "pendente" | "recebido" | "pago" | "cancelado" | "parcial" | "vencido";
  forma_pagamento: string | null;
  observacoes: string | null;
  numero_documento: string | null;
  cliente_id: string | null;
  cliente_nome: string | null;
  cliente_documento: string | null;
  cliente_telefone: string | null;
  cliente_celular: string | null;
  cliente_email: string | null;
  venda_id: string | null;
  venda_numero: string | null;
  venda_data: string | null;
  venda_total: number | null;
  conciliado_em: string | null;
}

function presetParaIntervalo(p: PeriodoPreset): { de: string; ate: string } | null {
  const hoje = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  if (p === "30d") {
    const de = new Date(hoje);
    de.setDate(de.getDate() - 30);
    return { de: fmt(de), ate: fmt(hoje) };
  }
  if (p === "mes") {
    const de = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const ate = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
    return { de: fmt(de), ate: fmt(ate) };
  }
  if (p === "mes_anterior") {
    const de = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    const ate = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
    return { de: fmt(de), ate: fmt(ate) };
  }
  if (p === "ano") {
    const de = new Date(hoje.getFullYear(), 0, 1);
    const ate = new Date(hoje.getFullYear(), 11, 31);
    return { de: fmt(de), ate: fmt(ate) };
  }
  return null;
}

function statusEfetivo(r: Pick<Row, "status" | "data_vencimento" | "saldo">): Row["status"] {
  if (r.status === "cancelado" || r.status === "pago" || r.status === "recebido") return r.status;
  // saldo > 0 e vencido?
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const venc = new Date(r.data_vencimento + "T00:00:00");
  if (r.saldo > 0 && venc < hoje) return "vencido";
  return r.status;
}

function statusBadge(s: Row["status"]) {
  switch (s) {
    case "pago":
    case "recebido":
      return <Badge className="bg-success/15 text-success hover:bg-success/15">Pago</Badge>;
    case "parcial":
      return <Badge className="bg-warning/15 text-warning-foreground hover:bg-warning/15">Parcial</Badge>;
    case "vencido":
      return <Badge variant="destructive">Vencido</Badge>;
    case "cancelado":
      return <Badge variant="outline" className="text-muted-foreground">Cancelado</Badge>;
    default:
      return <Badge variant="secondary">Pendente</Badge>;
  }
}

function Conteudo() {
  const navigate = useNavigate();

  // Filtros
  const { empresaAtual } = useEmpresaAtual();
  const ownerId = empresaAtual?.owner_id ?? null;
  const [audit, setAudit] = useState<RelatorioAuditoria | null>(null);

  // Filtros
  const [preset, setPreset] = useState<PeriodoPreset>("mes");
  const [dataDe, setDataDe] = useState<string>(() => {
    const r = presetParaIntervalo("mes")!;
    return r.de;
  });
  const [dataAte, setDataAte] = useState<string>(() => {
    const r = presetParaIntervalo("mes")!;
    return r.ate;
  });
  const [campoData, setCampoData] = useState<"vencimento" | "emissao" | "pagamento">(
    "vencimento",
  );
  const [statusFiltro, setStatusFiltro] = useState<StatusFiltro>("abertos");
  const [clienteId, setClienteId] = useState<string>("todos");
  const [busca, setBusca] = useState("");

  // Detalhe
  const [detalhe, setDetalhe] = useState<LancamentoDetalhe | null>(null);

  function aplicarPreset(p: PeriodoPreset) {
    setPreset(p);
    const r = presetParaIntervalo(p);
    if (r) {
      setDataDe(r.de);
      setDataAte(r.ate);
    }
  }

  function resetar() {
    aplicarPreset("mes");
    setCampoData("vencimento");
    setStatusFiltro("abertos");
    setClienteId("todos");
    setBusca("");
  }

  // Lista de clientes para o select
  const clientesQ = useQuery({
    queryKey: ["relatorio_cr_clientes"],
    queryFn: () => dataClient.relatorios.clientesOpcoes(),
  });

  const lancamentosQ = useQuery({
    queryKey: [
      "relatorio_contas_receber",
      ownerId,
      { dataDe, dataAte, campoData, statusFiltro, clienteId },
    ],
    enabled: !!ownerId,
    queryFn: async (): Promise<Row[]> => {
      const { rows: data, audit: a } = await fetchContasReceberAudit(ownerId, {
        inicio: dataDe,
        fim: dataAte,
        campoData,
        clienteId,
      });
      setAudit(a);
      const rows: Row[] = data.map((l) => {
        const valor = l.valor;
        const pago = l.valor_pago;
        const saldo = Math.max(0, valor - pago);
        return {
          id: l.id,
          descricao: l.descricao,
          valor,
          valor_pago: pago,
          saldo,
          data_emissao: l.data_emissao,
          data_vencimento: l.data_vencimento,
          data_pagamento: l.data_pagamento,
          status: l.status as Row["status"],
          forma_pagamento: l.forma_pagamento,
          observacoes: l.observacoes,
          numero_documento: l.numero_documento,
          cliente_id: l.cliente_id,
          cliente_nome: l.cliente_nome,
          cliente_documento: l.cliente_documento,
          cliente_telefone: l.cliente_telefone,
          cliente_celular: l.cliente_celular,
          cliente_email: l.cliente_email,
          venda_id: l.venda_id,
          venda_numero: l.venda_numero,
          venda_data: l.venda_data,
          venda_total: l.venda_total,
          conciliado_em: l.conciliado_em,
        };
      });
      return rows.map((r) => ({ ...r, status: statusEfetivo(r) }));
    },
  });

  const filtradas = useMemo(() => {
    let arr = lancamentosQ.data ?? [];
    if (statusFiltro !== "todos") {
      if (statusFiltro === "abertos") {
        arr = arr.filter(
          (r) => r.status === "pendente" || r.status === "parcial" || r.status === "vencido",
        );
      } else {
        arr = arr.filter((r) => r.status === statusFiltro);
      }
    }
    if (busca.trim()) {
      const q = busca.toLowerCase();
      arr = arr.filter(
        (r) =>
          r.descricao.toLowerCase().includes(q) ||
          (r.cliente_nome ?? "").toLowerCase().includes(q) ||
          (r.cliente_documento ?? "").toLowerCase().includes(q) ||
          (r.venda_numero ?? "").toLowerCase().includes(q) ||
          (r.numero_documento ?? "").toLowerCase().includes(q),
      );
    }
    return arr;
  }, [lancamentosQ.data, statusFiltro, busca]);

  // Indicadores
  const indicadores = useMemo(() => {
    const base = filtradas;
    let totalOriginal = 0;
    let totalRecebido = 0;
    let totalSaldo = 0;
    let qtdVencidas = 0;
    let saldoVencido = 0;
    let qtdAbertas = 0;
    for (const r of base) {
      totalOriginal += r.valor;
      totalRecebido += r.valor_pago;
      if (r.status !== "cancelado") {
        totalSaldo += r.saldo;
      }
      if (r.status === "vencido") {
        qtdVencidas += 1;
        saldoVencido += r.saldo;
      }
      if (r.status === "pendente" || r.status === "parcial" || r.status === "vencido") {
        qtdAbertas += 1;
      }
    }
    return { totalOriginal, totalRecebido, totalSaldo, qtdVencidas, saldoVencido, qtdAbertas };
  }, [filtradas]);

  // Agrupamento por cliente
  const porCliente = useMemo(() => {
    const map = new Map<
      string,
      {
        cliente_id: string | null;
        cliente_nome: string;
        cliente_documento: string | null;
        cliente_telefone: string | null;
        qtd: number;
        original: number;
        recebido: number;
        saldo: number;
        vencido: number;
      }
    >();
    for (const r of filtradas) {
      const key = r.cliente_id ?? "_sem";
      const cur = map.get(key) ?? {
        cliente_id: r.cliente_id,
        cliente_nome: r.cliente_nome ?? "Sem cliente",
        cliente_documento: r.cliente_documento,
        cliente_telefone: r.cliente_telefone ?? r.cliente_celular,
        qtd: 0,
        original: 0,
        recebido: 0,
        saldo: 0,
        vencido: 0,
      };
      cur.qtd += 1;
      cur.original += r.valor;
      cur.recebido += r.valor_pago;
      if (r.status !== "cancelado") cur.saldo += r.saldo;
      if (r.status === "vencido") cur.vencido += r.saldo;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.saldo - a.saldo);
  }, [filtradas]);

  // Agrupamento por mês de vencimento
  const porMes = useMemo(() => {
    const map = new Map<string, { mes: string; original: number; recebido: number; saldo: number; qtd: number }>();
    for (const r of filtradas) {
      const ref = (campoData === "pagamento" ? r.data_pagamento : campoData === "emissao" ? r.data_emissao : r.data_vencimento) ?? r.data_vencimento;
      const mes = ref.slice(0, 7); // YYYY-MM
      const cur = map.get(mes) ?? { mes, original: 0, recebido: 0, saldo: 0, qtd: 0 };
      cur.qtd += 1;
      cur.original += r.valor;
      cur.recebido += r.valor_pago;
      if (r.status !== "cancelado") cur.saldo += r.saldo;
      map.set(mes, cur);
    }
    return Array.from(map.values()).sort((a, b) => a.mes.localeCompare(b.mes));
  }, [filtradas, campoData]);

  function exportar() {
    if (filtradas.length === 0) {
      toast.warning("Sem dados para exportar.");
      return;
    }
    const cols: CsvColumn<Row>[] = [
      { header: "Data emissao", accessor: (r) => r.data_emissao ?? "", type: "date" },
      { header: "Vencimento", accessor: (r) => r.data_vencimento, type: "date" },
      { header: "Pagamento", accessor: (r) => r.data_pagamento ?? "", type: "date" },
      { header: "Descricao", accessor: (r) => r.descricao, type: "text" },
      { header: "Cliente", accessor: (r) => r.cliente_nome ?? "", type: "text" },
      { header: "CPF/CNPJ", accessor: (r) => r.cliente_documento ?? "", type: "text" },
      { header: "Telefone", accessor: (r) => r.cliente_telefone ?? r.cliente_celular ?? "", type: "text" },
      { header: "Venda", accessor: (r) => r.venda_numero ?? "", type: "text" },
      { header: "Documento", accessor: (r) => r.numero_documento ?? "", type: "text" },
      { header: "Valor original", accessor: (r) => r.valor, type: "currency" },
      { header: "Valor pago", accessor: (r) => r.valor_pago, type: "currency" },
      { header: "Saldo restante", accessor: (r) => r.saldo, type: "currency" },
      { header: "Status", accessor: (r) => r.status, type: "text" },
      { header: "Forma pagamento", accessor: (r) => r.forma_pagamento ?? "", type: "text" },
      { header: "Observacoes", accessor: (r) => r.observacoes ?? "", type: "text" },
    ];
    exportRowsToCSV("contas-receber", filtradas, cols);
    toast.success("Download iniciado");
  }

  function abrirDetalhe(r: Row) {
    const det: LancamentoDetalhe = {
      id: r.id,
      descricao: r.descricao,
      valor: r.valor,
      valor_pago: r.valor_pago,
      data_vencimento: r.data_vencimento,
      data_pagamento: r.data_pagamento,
      data_emissao: r.data_emissao,
      tipo: "receber",
      status: r.status,
      observacoes: r.observacoes,
      numero_documento: r.numero_documento,
      cliente_nome: r.cliente_nome,
      cliente_documento: r.cliente_documento,
      cliente_telefone: r.cliente_telefone ?? r.cliente_celular,
      cliente_email: r.cliente_email,
      venda_id: r.venda_id,
      venda_numero: r.venda_numero,
      venda_data: r.venda_data,
      venda_total: r.venda_total,
      forma_pagamento: r.forma_pagamento,
      conciliado_em: r.conciliado_em,
    } as LancamentoDetalhe;
    setDetalhe(det);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contas a receber"
        description="Acompanhe recebíveis por cliente, período e mês."
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate({ to: "/relatorios" })}
            >
              <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
            </Button>
            <Button size="sm" onClick={exportar}>
              <Download className="mr-2 h-4 w-4" /> Exportar CSV
            </Button>
          </div>
        }
      />

      {/* Filtros */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="h-4 w-4" /> Filtros
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
            <div className="space-y-1.5">
              <Label>Período</Label>
              <Select value={preset} onValueChange={(v) => aplicarPreset(v as PeriodoPreset)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30d">Últimos 30 dias</SelectItem>
                  <SelectItem value="mes">Este mês</SelectItem>
                  <SelectItem value="mes_anterior">Mês anterior</SelectItem>
                  <SelectItem value="ano">Este ano</SelectItem>
                  <SelectItem value="personalizado">Personalizado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>De</Label>
              <Input
                type="date"
                value={dataDe}
                onChange={(e) => {
                  setDataDe(e.target.value);
                  setPreset("personalizado");
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Até</Label>
              <Input
                type="date"
                value={dataAte}
                onChange={(e) => {
                  setDataAte(e.target.value);
                  setPreset("personalizado");
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Campo de data</Label>
              <Select value={campoData} onValueChange={(v) => setCampoData(v as typeof campoData)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vencimento">Vencimento</SelectItem>
                  <SelectItem value="emissao">Emissão</SelectItem>
                  <SelectItem value="pagamento">Pagamento</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={statusFiltro} onValueChange={(v) => setStatusFiltro(v as StatusFiltro)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="abertos">Em aberto</SelectItem>
                  <SelectItem value="pendente">Pendente</SelectItem>
                  <SelectItem value="parcial">Parcial</SelectItem>
                  <SelectItem value="vencido">Vencido</SelectItem>
                  <SelectItem value="pago">Pago</SelectItem>
                  <SelectItem value="cancelado">Cancelado</SelectItem>
                  <SelectItem value="todos">Todos</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Cliente</Label>
              <Select value={clienteId} onValueChange={setClienteId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="todos">Todos os clientes</SelectItem>
                  {(clientesQ.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome_fantasia || c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div className="md:max-w-md flex-1">
              <Label>Busca</Label>
              <Input
                placeholder="Descrição, cliente, CPF, venda..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
            <Button variant="outline" size="sm" onClick={resetar}>
              <RotateCcw className="mr-2 h-4 w-4" /> Limpar filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Indicadores */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="A receber"
          value={formatBRL(indicadores.totalSaldo)}
          icon={Wallet}
          iconTone="warning"
          hint={`${indicadores.qtdAbertas} título(s) aberto(s)`}
        />
        <StatCard
          label="Recebido"
          value={formatBRL(indicadores.totalRecebido)}
          icon={CheckCircle2}
          iconTone="success"
          hint="Pagamentos no período"
        />
        <StatCard
          label="Vencidos"
          value={formatBRL(indicadores.saldoVencido)}
          icon={AlertTriangle}
          iconTone="danger"
          hint={`${indicadores.qtdVencidas} título(s)`}
        />
        <StatCard
          label="Total emitido"
          value={formatBRL(indicadores.totalOriginal)}
          icon={HandCoins}
          iconTone="info"
          hint={`${filtradas.length} lançamento(s)`}
        />
      </div>

      {/* Por cliente */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Resumo por cliente</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>CPF/CNPJ</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead className="text-right">Títulos</TableHead>
                  <TableHead className="text-right">Original</TableHead>
                  <TableHead className="text-right">Recebido</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="text-right">Vencido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {porCliente.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                      Nenhum cliente encontrado para os filtros.
                    </TableCell>
                  </TableRow>
                )}
                {porCliente.map((c) => (
                  <TableRow key={c.cliente_id ?? "_sem"}>
                    <TableCell className="font-medium">{c.cliente_nome}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {c.cliente_documento ? formatarDocumento(c.cliente_documento) : "—"}
                    </TableCell>
                    <TableCell className="text-xs">{c.cliente_telefone ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.qtd}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatBRL(c.original)}</TableCell>
                    <TableCell className="text-right tabular-nums text-success">
                      {formatBRL(c.recebido)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-warning">
                      {formatBRL(c.saldo)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        c.vencido > 0 ? "font-semibold text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {c.vencido > 0 ? formatBRL(c.vencido) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Por mês */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Por mês</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mês</TableHead>
                  <TableHead className="text-right">Títulos</TableHead>
                  <TableHead className="text-right">Original</TableHead>
                  <TableHead className="text-right">Recebido</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {porMes.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      Nenhum dado no período.
                    </TableCell>
                  </TableRow>
                )}
                {porMes.map((m) => (
                  <TableRow key={m.mes}>
                    <TableCell className="font-medium">{formatMes(m.mes)}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.qtd}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatBRL(m.original)}</TableCell>
                    <TableCell className="text-right tabular-nums text-success">
                      {formatBRL(m.recebido)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-warning">
                      {formatBRL(m.saldo)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Detalhe analítico */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Detalhe ({filtradas.length} título{filtradas.length === 1 ? "" : "s"})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {lancamentosQ.isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Documento</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Venda</TableHead>
                    <TableHead className="text-right">Original</TableHead>
                    <TableHead className="text-right">Pago</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtradas.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                        Nenhum lançamento encontrado.
                      </TableCell>
                    </TableRow>
                  )}
                  {filtradas.map((r) => (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => abrirDetalhe(r)}
                    >
                      <TableCell className="text-sm">
                        {formatDataBR(r.data_vencimento)}
                        {r.data_pagamento && (
                          <div className="text-[11px] text-muted-foreground">
                            Pago em {formatDataBR(r.data_pagamento)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{r.cliente_nome ?? "—"}</div>
                        <div className="text-xs text-muted-foreground line-clamp-1">
                          {r.descricao}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.cliente_documento ? formatarDocumento(r.cliente_documento) : "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.cliente_telefone ?? r.cliente_celular ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">{r.venda_numero ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatBRL(r.valor)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-success">
                        {formatBRL(r.valor_pago)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-semibold tabular-nums",
                          r.saldo > 0 ? "text-warning" : "text-muted-foreground",
                        )}
                      >
                        {formatBRL(r.saldo)}
                      </TableCell>
                      <TableCell>{statusBadge(r.status)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AuditoriaCard audit={audit} />

      <LancamentoDetalheDialog
        open={!!detalhe}
        onOpenChange={(o) => !o && setDetalhe(null)}
        lancamento={detalhe}
      />
    </div>
  );
}

function formatDataBR(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso + (iso.length === 10 ? "T00:00:00" : "")).toLocaleDateString("pt-BR");
  } catch {
    return iso;
  }
}

function formatMes(yyyymm: string): string {
  const [y, m] = yyyymm.split("-");
  if (!y || !m) return yyyymm;
  const meses = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ];
  const idx = Number(m) - 1;
  return `${meses[idx] ?? m}/${y}`;
}
