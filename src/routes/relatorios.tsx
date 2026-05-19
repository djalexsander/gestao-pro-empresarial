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
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ModuloGate } from "@/components/saas/ModuloGate";
import { dataClient } from "@/integrations/data";
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
  route: "/relatorios/vendas" | "/relatorios/compras" | "/relatorios/estoque" | "/relatorios/fluxo-caixa" | "/relatorios/caixa" | "/relatorios/financeiro" | "/relatorios/contas-receber" | "/relatorios/dre" | "/relatorios/fiscal";
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
      const rows = await dataClient.relatorios.cardVendas();
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
    key: "compras",
    title: "Relatório de compras",
    description: "Compras por fornecedor e categoria.",
    icon: ShoppingCart,
    tone: "bg-info/10 text-info",
    route: "/relatorios/compras",
    filenamePrefix: "compras",
    exporter: async () => {
      const rows = await dataClient.relatorios.cardCompras();
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
      const { produtos, movimentos } = await dataClient.relatorios.estoqueBase();
      const saldos = new Map<string, number>();
      for (const m of movimentos) {
        const sinal =
          m.tipo === "entrada" || m.tipo === "devolucao"
            ? 1
            : m.tipo === "saida" || m.tipo === "transferencia"
              ? -1
              : 1;
        saldos.set(m.produto_id, (saldos.get(m.produto_id) ?? 0) + sinal * m.quantidade);
      }
      const rows = produtos.map((p) => ({
        sku: p.sku,
        nome: p.nome,
        unidade: p.unidade,
        custo: p.preco_custo,
        venda: p.preco_venda,
        minimo: p.estoque_minimo,
        saldo: saldos.get(p.id) ?? 0,
      }));
      const columns: CsvColumn<typeof rows[number]>[] = [
        { header: "SKU", accessor: (r) => r.sku ?? "", type: "text" },
        { header: "Produto", accessor: (r) => r.nome, type: "text" },
        { header: "Unidade", accessor: (r) => r.unidade ?? "", type: "text" },
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
    title: "Fluxo Financeiro Gerencial",
    description: "Compras, despesas, fornecedores e contas no período.",
    icon: Wallet,
    tone: "bg-success/10 text-success",
    route: "/relatorios/fluxo-caixa",
    filenamePrefix: "fluxo-caixa",
    exporter: async () => {
      const data = await dataClient.relatorios.cardFluxoCaixa();
      const rows = data.map((l) => ({
        descricao: l.descricao,
        tipo: l.tipo,
        valor: l.valor,
        valor_pago: l.valor_pago,
        emissao: l.emissao,
        vencimento: l.vencimento,
        pagamento: l.pagamento ?? "",
        status: l.status,
        forma: l.forma ?? "",
      }));
      const columns: CsvColumn<typeof rows[number]>[] = [
        { header: "Descricao", accessor: (r) => r.descricao ?? "", type: "text" },
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
      const data = await dataClient.relatorios.cardFinanceiro();
      const rows = data.map((l) => ({
        vencimento: l.data_vencimento,
        pagamento: l.data_pagamento ?? "",
        tipo: l.tipo,
        categoria: l.categoria_nome ?? "",
        descricao: l.descricao,
        pessoa: l.cliente_nome ?? l.fornecedor_nome ?? "",
        valor: l.valor,
        valor_pago: l.valor_pago,
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
      const data = await dataClient.relatorios.cardContasReceber();
      const rows = data.map((l) => ({
        vencimento: l.data_vencimento,
        emissao: l.data_emissao ?? "",
        pagamento: l.data_pagamento ?? "",
        cliente: l.cliente_nome ?? "",
        documento: l.cliente_documento ?? "",
        telefone: l.cliente_telefone ?? l.cliente_celular ?? "",
        venda: l.venda_numero ?? "",
        descricao: l.descricao,
        valor: l.valor,
        valor_pago: l.valor_pago,
        saldo: Math.max(0, l.valor - l.valor_pago),
        status: l.status,
        forma: l.forma_pagamento ?? "",
      }));
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
      const data = await dataClient.relatorios.cardCaixas();
      const rows = data.map((c) => ({
        abertura: c.abertura,
        fechamento: c.fechamento ?? "",
        inicial: c.inicial,
        vendas: c.vendas,
        sangrias: c.sangrias,
        suprimentos: c.suprimentos,
        esperado: c.esperado ?? "",
        informado: c.informado ?? "",
        diferenca: c.diferenca ?? "",
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
      const t = await dataClient.relatorios.dreTotais({ inicio, fim });
      const rows = [
        { conta: "Receita de vendas", valor: t.receita_vendas },
        { conta: "Outras receitas", valor: t.outras_receitas },
        { conta: "Despesas", valor: -t.despesas },
        { conta: "Resultado", valor: t.receita_vendas + t.outras_receitas - t.despesas },
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
      const rows = await dataClient.relatorios.cardNotasFiscais();
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
