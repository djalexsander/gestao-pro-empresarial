import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ModuloGate } from "@/components/saas/ModuloGate";
import { supabase } from "@/integrations/supabase/client";
import { exportRowsToCSV, type CsvColumn } from "@/lib/export-csv";

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
  route: "/relatorios/vendas" | "/relatorios/compras" | "/relatorios/estoque" | "/relatorios/fluxo-caixa" | "/relatorios/caixa" | "/relatorios/financeiro" | "/relatorios/dre" | "/relatorios/fiscal";
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
        { header: "Número", accessor: (r) => r.numero },
        { header: "Data", accessor: (r) => r.data },
        { header: "Cliente", accessor: (r) => r.cliente },
        { header: "Forma pagamento", accessor: (r) => r.forma },
        { header: "Total", accessor: (r) => r.total },
        { header: "Status", accessor: (r) => r.status },
        { header: "Pagamento", accessor: (r) => r.pagamento },
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
        { header: "Número", accessor: (r) => r.numero },
        { header: "Data", accessor: (r) => r.data },
        { header: "Fornecedor", accessor: (r) => r.fornecedor },
        { header: "Total", accessor: (r) => r.total },
        { header: "Status", accessor: (r) => r.status },
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
        { header: "SKU", accessor: (r) => r.sku },
        { header: "Produto", accessor: (r) => r.nome },
        { header: "Unidade", accessor: (r) => r.unidade },
        { header: "Saldo", accessor: (r) => r.saldo },
        { header: "Mínimo", accessor: (r) => r.minimo },
        { header: "Custo", accessor: (r) => r.custo },
        { header: "Venda", accessor: (r) => r.venda },
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
        { header: "Descrição", accessor: (r) => r.descricao },
        { header: "Tipo", accessor: (r) => r.tipo },
        { header: "Valor", accessor: (r) => r.valor },
        { header: "Valor pago", accessor: (r) => r.valor_pago },
        { header: "Emissão", accessor: (r) => r.emissao },
        { header: "Vencimento", accessor: (r) => r.vencimento },
        { header: "Pagamento", accessor: (r) => r.pagamento },
        { header: "Status", accessor: (r) => r.status },
        { header: "Forma", accessor: (r) => r.forma },
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
        { header: "Data vencimento", accessor: (r) => r.vencimento },
        { header: "Data pagamento", accessor: (r) => r.pagamento },
        { header: "Tipo", accessor: (r) => r.tipo },
        { header: "Categoria", accessor: (r) => r.categoria },
        { header: "Descrição", accessor: (r) => r.descricao },
        { header: "Cliente/Fornecedor", accessor: (r) => r.pessoa },
        { header: "Valor", accessor: (r) => r.valor },
        { header: "Valor pago", accessor: (r) => r.valor_pago },
        { header: "Forma pagamento", accessor: (r) => r.forma },
        { header: "Status", accessor: (r) => r.status },
      ];
      return { rows, columns };
    },
  },
  {
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
        { header: "Abertura", accessor: (r) => r.abertura },
        { header: "Fechamento", accessor: (r) => r.fechamento },
        { header: "Valor inicial", accessor: (r) => r.inicial },
        { header: "Total vendas", accessor: (r) => r.vendas },
        { header: "Sangrias", accessor: (r) => r.sangrias },
        { header: "Suprimentos", accessor: (r) => r.suprimentos },
        { header: "Esperado", accessor: (r) => r.esperado },
        { header: "Informado", accessor: (r) => r.informado },
        { header: "Diferença", accessor: (r) => r.diferenca },
        { header: "Status", accessor: (r) => r.status },
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
        { header: "Conta", accessor: (r) => r.conta },
        { header: "Valor", accessor: (r) => r.valor },
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
        { header: "Venda", accessor: (r) => r.venda },
        { header: "NF", accessor: (r) => r.nf },
        { header: "Série", accessor: (r) => r.serie },
        { header: "Data", accessor: (r) => r.data },
        { header: "Total", accessor: (r) => r.total },
        { header: "Status", accessor: (r) => r.status },
      ];
      return { rows, columns };
    },
  },
];

function ReportsPage() {
  return (
    <ModuloGate chave="relatorios" titulo="Relatórios">
      <ReportsContent />
    </ModuloGate>
  );
}

function ReportsContent() {
  const navigate = useNavigate();
  const [exportingKey, setExportingKey] = useState<string | null>(null);

  async function handleExport(r: Report) {
    setExportingKey(r.key);
    toast.loading("Gerando relatório...", { id: `export-${r.key}` });
    try {
      const { rows, columns } = await r.exporter();
      if (rows.length === 0) {
        toast.warning("Sem dados para exportar.", { id: `export-${r.key}` });
        return;
      }
      exportRowsToCSV(r.filenamePrefix, rows, columns);
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
                    onClick={() => handleExport(r)}
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
    </div>
  );
}
