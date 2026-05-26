import { createFileRoute, useNavigate, Outlet, useMatchRoute } from "@tanstack/react-router";
import {
  BarChart3,
  Boxes,
  FileText,
  Receipt,
  ShoppingCart,
  Wallet,
  Download,
  Eye,
  Loader2,
  CircleDollarSign,
  PiggyBank,
  HandCoins,
  Package,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ModuloGate } from "@/components/saas/ModuloGate";
import { supabase } from "@/integrations/supabase/client";
import { type CsvColumn } from "@/lib/export-csv";
import { ExportFormatDialog } from "@/components/shared/ExportFormatDialog";
import {
  exportarRelatorioCard,
  type ExportFormato,
} from "@/lib/export-relatorio-card";

export const Route = createFileRoute("/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios — Gestão Pro" },
      { name: "description", content: "Relatórios analíticos do negócio." },
    ],
  }),
  component: ReportsPage,
});

interface Report {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  tone: string;
  route: "/relatorios/vendas" | "/relatorios/compras" | "/relatorios/estoque" | "/relatorios/fluxo-caixa" | "/relatorios/caixa" | "/relatorios/financeiro" | "/relatorios/contas-receber" | "/relatorios/dre" | "/relatorios/fiscal" | "/relatorios/produtos-vendidos";
  filenamePrefix: string;
  /** Carrega + colunas para export rápido a partir do card. */
  exporter: () => Promise<{ rows: any[]; columns: CsvColumn<any>[] }>;
}

const reports: Report[] = [
  {
    key: "vendas",
    title: "Relatório de vendas",
    description: "Vendas por período, vendedor e produto.",
    icon: Receipt,
    tone: "bg-primary/10 text-primary",
    route: "/relatorios/vendas",
    filenamePrefix: "vendas",
    exporter: async () => {
      const { data, error } = await supabase
        .from("vendas")
        .select("numero, data_emissao, total, status, status_pagamento, forma_pagamento, cliente:clientes(nome)")
        .order("data_emissao", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const rows = (data ?? []).map((v: any) => ({
        numero: v.numero,
        data: v.data_emissao,
        cliente: v.cliente?.nome ?? "Consumidor",
        forma: v.forma_pagamento ?? "",
        total: Number(v.total) || 0,
        status: v.status,
        pagamento: v.status_pagamento,
      }));
      const columns: CsvColumn<typeof rows[number]>[] = [
        { header: "Numero", accessor: (r) => r.numero, type: "text" },
        { header: "Data", accessor: (r) => r.data, type: "datetime" },
        { header: "Cliente", accessor: (r) => r.cliente, type: "text" },
        { header: "Forma pagamento", accessor: (r) => r.forma, type: "text" },
        { header: "Total", accessor: (r) => r.total, type: "currency" },
        { header: "Status", accessor: (r) => r.status, type: "text" },
        { header: "Pagamento", accessor: (r) => r.pagamento, type: "text" },
      ];
      return { rows, columns };
    },
  },
  {
    key: "produtos-vendidos",
    title: "Produtos Vendidos",
    description: "Quais produtos foram vendidos, qtd, faturamento, lucro e margem.",
    icon: Package,
    tone: "bg-chart-3/15 text-chart-3",
    route: "/relatorios/produtos-vendidos",
    filenamePrefix: "produtos-vendidos",
    exporter: async () => {
      const { data, error } = await supabase
        .from("venda_itens")
        .select(
          "quantidade, preco_unitario, total, descricao, produto:produtos(nome, sku, codigo_barras, preco_custo), venda:vendas!inner(numero, data_emissao, status)",
        )
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      const rows = (data ?? [])
        .filter((it: any) => it.venda?.status !== "cancelada")
        .map((it: any) => {
          const qtd = Number(it.quantidade) || 0;
          const total = Number(it.total) || 0;
          const custoUnit = Number(it.produto?.preco_custo) || 0;
          const custoTotal = custoUnit * qtd;
          const lucro = total - custoTotal;
          return {
            data: it.venda?.data_emissao ?? "",
            venda: it.venda?.numero ?? "",
            produto: it.produto?.nome ?? it.descricao ?? "",
            sku: it.produto?.sku ?? "",
            codigo: it.produto?.codigo_barras ?? "",
            qtd,
            unit: Number(it.preco_unitario) || 0,
            total,
            custo: custoTotal,
            lucro,
            margem: total > 0 ? Number(((lucro / total) * 100).toFixed(2)) : 0,
          };
        });
      const columns: CsvColumn<(typeof rows)[number]>[] = [
        { header: "Data", accessor: (r) => r.data, type: "date" },
        { header: "Venda", accessor: (r) => r.venda, type: "text" },
        { header: "Produto", accessor: (r) => r.produto, type: "text" },
        { header: "SKU", accessor: (r) => r.sku, type: "text" },
        { header: "Cod. barras", accessor: (r) => r.codigo, type: "text" },
        { header: "Qtd", accessor: (r) => r.qtd, type: "number" },
        { header: "Preço unit.", accessor: (r) => r.unit, type: "currency" },
        { header: "Total", accessor: (r) => r.total, type: "currency" },
        { header: "Custo total", accessor: (r) => r.custo, type: "currency" },
        { header: "Lucro", accessor: (r) => r.lucro, type: "currency" },
        { header: "Margem %", accessor: (r) => r.margem, type: "number" },
      ];
      return { rows, columns };
    },
  },
  {
    key: "compras",
    title: "Relatório de compras",
    description: "Compras por fornecedor e categoria.",
    icon: ShoppingCart,
    tone: "bg-info/10 text-info",
    route: "/relatorios/compras",
    filenamePrefix: "compras",
    exporter: async () => {
      const { data, error } = await supabase
        .from("compras")
        .select("numero, data_emissao, total, status, fornecedor:fornecedores(razao_social)")
        .order("data_emissao", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const rows = (data ?? []).map((c: any) => ({
        numero: c.numero,
        data: c.data_emissao,
        fornecedor: c.fornecedor?.razao_social ?? "—",
        total: Number(c.total) || 0,
        status: c.status,
      }));
      const columns: CsvColumn<typeof rows[number]>[] = [
        { header: "Numero", accessor: (r) => r.numero, type: "text" },
        { header: "Data", accessor: (r) => r.data, type: "date" },
        { header: "Fornecedor", accessor: (r) => r.fornecedor, type: "text" },
        { header: "Total", accessor: (r) => r.total, type: "currency" },
        { header: "Status", accessor: (r) => r.status, type: "text" },
      ];
      return { rows, columns };
    },
  },
  {
    key: "estoque",
    title: "Posição de estoque",
    description: "Saldo, movimentações e curva ABC.",
    icon: Boxes,
    tone: "bg-warning/15 text-warning-foreground",
    route: "/relatorios/estoque",
    filenamePrefix: "estoque",
    exporter: async () => {
      const { data: produtos, error } = await supabase
        .from("produtos")
        .select("sku, nome, unidade, preco_custo, preco_venda, estoque_minimo, status")
        .eq("status", "ativo")
        .order("nome", { ascending: true })
        .limit(1000);
      if (error) throw error;
      const { data: movs } = await supabase
        .from("estoque_movimentacoes")
        .select("produto_id, tipo, quantidade");
      const saldoPorProd = new Map<string, number>();
      for (const m of movs ?? []) {
        const sinal =
          m.tipo === "entrada" || m.tipo === "devolucao"
            ? 1
            : m.tipo === "saida" || m.tipo === "transferencia"
              ? -1
              : 1;
        // saldo agregado vai precisar do produto_id; produtos não traz id aqui — vamos buscar com id
      }
      // Refaz buscando id
      const { data: produtosFull } = await supabase
        .from("produtos")
        .select("id, sku, nome, unidade, preco_custo, preco_venda, estoque_minimo, status")
        .eq("status", "ativo")
        .order("nome", { ascending: true })
        .limit(1000);
      const saldos = new Map<string, number>();
      for (const m of movs ?? []) {
        const sinal =
          m.tipo === "entrada" || m.tipo === "devolucao"
            ? 1
            : m.tipo === "saida" || m.tipo === "transferencia"
              ? -1
              : 1;
        saldos.set(m.produto_id, (saldos.get(m.produto_id) ?? 0) + sinal * Number(m.quantidade));
      }
      const rows = (produtosFull ?? []).map((p: any) => ({
        sku: p.sku,
        nome: p.nome,
        unidade: p.unidade,
        custo: Number(p.preco_custo) || 0,
        venda: Number(p.preco_venda) || 0,
        minimo: Number(p.estoque_minimo) || 0,
        saldo: saldos.get(p.id) ?? 0,
      }));
      const columns: CsvColumn<typeof rows[number]>[] = [
        { header: "SKU", accessor: (r) => r.sku, type: "text" },
        { header: "Produto", accessor: (r) => r.nome, type: "text" },
        { header: "Unidade", accessor: (r) => r.unidade, type: "text" },
        { header: "Saldo", accessor: (r) => r.saldo, type: "number" },
        { header: "Minimo", accessor: (r) => r.minimo, type: "number" },
        { header: "Custo", accessor: (r) => r.custo, type: "currency" },
        { header: "Venda", accessor: (r) => r.venda, type: "currency" },
      ];
      return { rows, columns };
    },
  },
  {
    key: "fluxo-caixa",
    title: "Fluxo de caixa",
    description: "Entradas, saídas e projeção.",
    icon: Wallet,
    tone: "bg-success/10 text-success",
    route: "/relatorios/fluxo-caixa",
    filenamePrefix: "fluxo-caixa",
    exporter: async () => {
      const { data, error } = await supabase
        .from("financeiro_lancamentos")
        .select("descricao, tipo, valor, valor_pago, data_emissao, data_vencimento, data_pagamento, status, forma_pagamento")
        .order("data_vencimento", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const rows = (data ?? []).map((l: any) => ({
        descricao: l.descricao,
        tipo: l.tipo,
        valor: Number(l.valor) || 0,
        valor_pago: Number(l.valor_pago) || 0,
        emissao: l.data_emissao,
        vencimento: l.data_vencimento,
        pagamento: l.data_pagamento ?? "",
        status: l.status,
        forma: l.forma_pagamento ?? "",
      }));
      const columns: CsvColumn<typeof rows[number]>[] = [
        { header: "Descricao", accessor: (r) => r.descricao, type: "text" },
        { header: "Tipo", accessor: (r) => r.tipo, type: "text" },
        { header: "Valor", accessor: (r) => r.valor, type: "currency" },
        { header: "Valor pago", accessor: (r) => r.valor_pago, type: "currency" },
        { header: "Emissao", accessor: (r) => r.emissao, type: "date" },
        { header: "Vencimento", accessor: (r) => r.vencimento, type: "date" },
        { header: "Pagamento", accessor: (r) => r.pagamento, type: "date" },
        { header: "Status", accessor: (r) => r.status, type: "text" },
        { header: "Forma", accessor: (r) => r.forma, type: "text" },
      ];
      return { rows, columns };
    },
  },
  {
    key: "financeiro",
    title: "Relatório financeiro",
    description: "Receitas, despesas, lucro e contas em aberto.",
    icon: PiggyBank,
    tone: "bg-success/10 text-success",
    route: "/relatorios/financeiro",
    filenamePrefix: "financeiro",
    exporter: async () => {
      const { data, error } = await supabase
        .from("financeiro_lancamentos")
        .select(
          "descricao, tipo, valor, valor_pago, data_emissao, data_vencimento, data_pagamento, status, forma_pagamento, categoria:categorias_financeiras(nome), cliente:clientes(nome), fornecedor:fornecedores(razao_social, nome_fantasia)",
        )
        .neq("status", "cancelado")
        .order("data_vencimento", { ascending: false })
        .limit(2000);
      if (error) throw error;
      const rows = (data ?? []).map((l: any) => ({
        vencimento: l.data_vencimento,
        pagamento: l.data_pagamento ?? "",
        tipo: l.tipo,
        categoria: l.categoria?.nome ?? "",
        descricao: l.descricao,
        pessoa: l.cliente?.nome ?? l.fornecedor?.nome_fantasia ?? l.fornecedor?.razao_social ?? "",
        valor: Number(l.valor) || 0,
        valor_pago: Number(l.valor_pago) || 0,
        forma: l.forma_pagamento ?? "",
        status: l.status,
      }));
      const columns: CsvColumn<typeof rows[number]>[] = [
        { header: "Data vencimento", accessor: (r) => r.vencimento, type: "date" },
        { header: "Data pagamento", accessor: (r) => r.pagamento, type: "date" },
        { header: "Tipo", accessor: (r) => r.tipo, type: "text" },
        { header: "Categoria", accessor: (r) => r.categoria, type: "text" },
        { header: "Descricao", accessor: (r) => r.descricao, type: "text" },
        { header: "Cliente/Fornecedor", accessor: (r) => r.pessoa, type: "text" },
        { header: "Valor", accessor: (r) => r.valor, type: "currency" },
        { header: "Valor pago", accessor: (r) => r.valor_pago, type: "currency" },
        { header: "Forma pagamento", accessor: (r) => r.forma, type: "text" },
        { header: "Status", accessor: (r) => r.status, type: "text" },
      ];
      return { rows, columns };
    },
  },
  {
    key: "contas-receber",
    title: "Contas a receber",
    description: "Recebíveis por cliente, período e mês com saldo restante.",
    icon: HandCoins,
    tone: "bg-warning/15 text-warning-foreground",
    route: "/relatorios/contas-receber",
    filenamePrefix: "contas-receber",
    exporter: async () => {
      const { data, error } = await supabase
        .from("financeiro_lancamentos")
        .select(
          "descricao, valor, valor_pago, data_emissao, data_vencimento, data_pagamento, status, forma_pagamento, numero_documento, cliente:clientes(nome, nome_fantasia, documento, telefone, celular), venda:vendas(numero)",
        )
        .eq("tipo", "receber")
        .neq("status", "cancelado")
        .order("data_vencimento", { ascending: false })
        .limit(2000);
      if (error) throw error;
      const rows = (data ?? []).map((l: Record<string, unknown>) => {
        const valor = Number(l.valor) || 0;
        const pago = Number(l.valor_pago) || 0;
        const cli = l.cliente as Record<string, unknown> | null;
        const ven = l.venda as Record<string, unknown> | null;
        return {
          vencimento: l.data_vencimento as string,
          emissao: (l.data_emissao as string) ?? "",
          pagamento: (l.data_pagamento as string) ?? "",
          cliente: cli ? ((cli.nome_fantasia as string) || (cli.nome as string)) : "",
          documento: cli ? ((cli.documento as string) ?? "") : "",
          telefone: cli ? ((cli.telefone as string) ?? (cli.celular as string) ?? "") : "",
          venda: ven ? ((ven.numero as string) ?? "") : "",
          descricao: l.descricao as string,
          valor,
          valor_pago: pago,
          saldo: Math.max(0, valor - pago),
          status: l.status as string,
          forma: (l.forma_pagamento as string) ?? "",
        };
      });
      const columns: CsvColumn<typeof rows[number]>[] = [
        { header: "Vencimento", accessor: (r) => r.vencimento, type: "date" },
        { header: "Emissao", accessor: (r) => r.emissao, type: "date" },
        { header: "Pagamento", accessor: (r) => r.pagamento, type: "date" },
        { header: "Cliente", accessor: (r) => r.cliente, type: "text" },
        { header: "CPF/CNPJ", accessor: (r) => r.documento, type: "text" },
        { header: "Telefone", accessor: (r) => r.telefone, type: "text" },
        { header: "Venda", accessor: (r) => r.venda, type: "text" },
        { header: "Descricao", accessor: (r) => r.descricao, type: "text" },
        { header: "Valor original", accessor: (r) => r.valor, type: "currency" },
        { header: "Valor pago", accessor: (r) => r.valor_pago, type: "currency" },
        { header: "Saldo", accessor: (r) => r.saldo, type: "currency" },
        { header: "Forma", accessor: (r) => r.forma, type: "text" },
        { header: "Status", accessor: (r) => r.status, type: "text" },
      ];
      return { rows, columns };
    },
  },
  {
    key: "caixa",
    title: "Relatório de caixa",
    description: "Aberturas, fechamentos e auditoria de PDV.",
    icon: CircleDollarSign,
    tone: "bg-chart-2/15 text-chart-2",
    route: "/relatorios/caixa",
    filenamePrefix: "caixa",
    exporter: async () => {
      const { data, error } = await supabase
        .from("caixas")
        .select(
          "data_abertura, data_fechamento, valor_inicial, total_vendas, total_sangrias, total_suprimentos, valor_esperado, valor_informado, diferenca, status",
        )
        .order("data_abertura", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const rows = (data ?? []).map((c: any) => ({
        abertura: c.data_abertura,
        fechamento: c.data_fechamento ?? "",
        inicial: Number(c.valor_inicial) || 0,
        vendas: Number(c.total_vendas) || 0,
        sangrias: Number(c.total_sangrias) || 0,
        suprimentos: Number(c.total_suprimentos) || 0,
        esperado: c.valor_esperado != null ? Number(c.valor_esperado) : "",
        informado: c.valor_informado != null ? Number(c.valor_informado) : "",
        diferenca: c.diferenca != null ? Number(c.diferenca) : "",
        status: c.status,
      }));
      const columns: CsvColumn<typeof rows[number]>[] = [
        { header: "Abertura", accessor: (r) => r.abertura, type: "datetime" },
        { header: "Fechamento", accessor: (r) => r.fechamento, type: "datetime" },
        { header: "Valor inicial", accessor: (r) => r.inicial, type: "currency" },
        { header: "Total vendas", accessor: (r) => r.vendas, type: "currency" },
        { header: "Sangrias", accessor: (r) => r.sangrias, type: "currency" },
        { header: "Suprimentos", accessor: (r) => r.suprimentos, type: "currency" },
        { header: "Esperado", accessor: (r) => r.esperado, type: "currency" },
        { header: "Informado", accessor: (r) => r.informado, type: "currency" },
        { header: "Diferenca", accessor: (r) => r.diferenca, type: "currency" },
        { header: "Status", accessor: (r) => r.status, type: "text" },
      ];
      return { rows, columns };
    },
  },
  {
    key: "dre",
    title: "DRE simplificado",
    description: "Demonstrativo de resultados do período.",
    icon: BarChart3,
    tone: "bg-chart-4/15 text-chart-4",
    route: "/relatorios/dre",
    filenamePrefix: "dre",
    exporter: async () => {
      const today = new Date();
      const inicio = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
      const fim = today.toISOString().slice(0, 10);
      const [{ data: vendas }, { data: lanc }] = await Promise.all([
        supabase.from("vendas").select("total").gte("data_emissao", inicio).lte("data_emissao", fim).neq("status", "cancelada"),
        supabase.from("financeiro_lancamentos").select("tipo, valor_pago").gte("data_pagamento", inicio).lte("data_pagamento", fim).eq("status", "pago"),
      ]);
      const receita = (vendas ?? []).reduce((a: number, v: any) => a + (Number(v.total) || 0), 0);
      const despesas = (lanc ?? []).filter((l: any) => l.tipo === "despesa").reduce((a: number, l: any) => a + (Number(l.valor_pago) || 0), 0);
      const outras_receitas = (lanc ?? []).filter((l: any) => l.tipo === "receita").reduce((a: number, l: any) => a + (Number(l.valor_pago) || 0), 0);
      const rows = [
        { conta: "Receita de vendas", valor: receita },
        { conta: "Outras receitas", valor: outras_receitas },
        { conta: "Despesas", valor: -despesas },
        { conta: "Resultado", valor: receita + outras_receitas - despesas },
      ];
      const columns: CsvColumn<typeof rows[number]>[] = [
        { header: "Conta", accessor: (r) => r.conta, type: "text" },
        { header: "Valor", accessor: (r) => r.valor, type: "currency" },
      ];
      return { rows, columns };
    },
  },
  {
    key: "fiscal",
    title: "Relatório fiscal",
    description: "Notas emitidas e impostos apurados.",
    icon: FileText,
    tone: "bg-destructive/10 text-destructive",
    route: "/relatorios/fiscal",
    filenamePrefix: "fiscal",
    exporter: async () => {
      const { data, error } = await supabase
        .from("vendas")
        .select("numero, numero_nf, serie_nf, data_emissao, total, status")
        .not("numero_nf", "is", null)
        .order("data_emissao", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const rows = (data ?? []).map((v: any) => ({
        venda: v.numero,
        nf: v.numero_nf,
        serie: v.serie_nf ?? "",
        data: v.data_emissao,
        total: Number(v.total) || 0,
        status: v.status,
      }));
      const columns: CsvColumn<typeof rows[number]>[] = [
        { header: "Venda", accessor: (r) => r.venda, type: "text" },
        { header: "NF", accessor: (r) => r.nf, type: "text" },
        { header: "Serie", accessor: (r) => r.serie, type: "text" },
        { header: "Data", accessor: (r) => r.data, type: "datetime" },
        { header: "Total", accessor: (r) => r.total, type: "currency" },
        { header: "Status", accessor: (r) => r.status, type: "text" },
      ];
      return { rows, columns };
    },
  },
];

function ReportsPage() {
  const matchRoute = useMatchRoute();
  const isIndex = matchRoute({ to: "/relatorios", fuzzy: false });
  return (
    <ModuloGate chave="relatorios" titulo="Relatórios">
      {isIndex ? <ReportsContent /> : <Outlet />}
    </ModuloGate>
  );
}

function ReportsContent() {
  const navigate = useNavigate();
  const [exportingKey, setExportingKey] = useState<string | null>(null);
  const [dialogReport, setDialogReport] = useState<Report | null>(null);

  async function handleExport(r: Report, formato: ExportFormato) {
    setDialogReport(null);
    setExportingKey(r.key);
    toast.loading("Gerando relatório...", { id: `export-${r.key}` });
    try {
      const { rows, columns } = await r.exporter();
      if (rows.length === 0) {
        toast.warning("Sem dados para exportar.", { id: `export-${r.key}` });
        return;
      }
      await exportarRelatorioCard(formato, {
        prefix: r.filenamePrefix,
        titulo: r.title,
        rows,
        columns,
      });
      toast.success("Download iniciado", { id: `export-${r.key}` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao gerar relatório";
      toast.error(msg, { id: `export-${r.key}` });
    } finally {
      setExportingKey(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relatórios"
        description="Análises e relatórios disponíveis para sua operação."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((r) => {
          const exporting = exportingKey === r.key;
          return (
            <Card
              key={r.key}
              className="group transition-all hover:shadow-md hover:border-primary/30"
            >
              <CardContent className="p-5">
                <div
                  className={`mb-4 flex h-10 w-10 items-center justify-center rounded-lg ${r.tone}`}
                >
                  <r.icon className="h-5 w-5" />
                </div>
                <h3 className="font-semibold text-foreground">{r.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{r.description}</p>
                <div className="mt-4 flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => navigate({ to: r.route })}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Visualizar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5"
                    disabled={exporting}
                    onClick={() => setDialogReport(r)}
                  >
                    {exporting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    Exportar
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <ExportFormatDialog
        open={dialogReport !== null}
        onOpenChange={(o) => !o && setDialogReport(null)}
        titulo={dialogReport?.title ?? ""}
        loading={exportingKey !== null}
        onChoose={(f) => dialogReport && handleExport(dialogReport, f)}
      />
    </div>
  );
}
