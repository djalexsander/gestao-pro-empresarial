import { createFileRoute } from "@tanstack/react-router";
import {
  BarChart3,
  Boxes,
  FileText,
  Receipt,
  ShoppingCart,
  Wallet,
  Download,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ModuloGate } from "@/components/saas/ModuloGate";

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
  title: string;
  description: string;
  icon: LucideIcon;
  tone: string;
}

const reports: Report[] = [
  { title: "Relatório de vendas", description: "Vendas por período, vendedor e produto.", icon: Receipt, tone: "bg-primary/10 text-primary" },
  { title: "Relatório de compras", description: "Compras por fornecedor e categoria.", icon: ShoppingCart, tone: "bg-info/10 text-info" },
  { title: "Posição de estoque", description: "Saldo, movimentações e curva ABC.", icon: Boxes, tone: "bg-warning/15 text-warning-foreground" },
  { title: "Fluxo de caixa", description: "Entradas, saídas e projeção.", icon: Wallet, tone: "bg-success/10 text-success" },
  { title: "DRE simplificado", description: "Demonstrativo de resultados do período.", icon: BarChart3, tone: "bg-chart-4/15 text-chart-4" },
  { title: "Relatório fiscal", description: "Notas emitidas e impostos apurados.", icon: FileText, tone: "bg-destructive/10 text-destructive" },
];

function ReportsPage() {
  return (
    <ModuloGate chave="relatorios" titulo="Relatórios">
      <ReportsContent />
    </ModuloGate>
  );
}

function ReportsContent() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Relatórios"
        description="Análises e relatórios disponíveis para sua operação."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((r) => (
          <Card key={r.title} className="group cursor-pointer transition-all hover:shadow-md hover:border-primary/30">
            <CardContent className="p-5">
              <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-lg ${r.tone}`}>
                <r.icon className="h-5 w-5" />
              </div>
              <h3 className="font-semibold text-foreground">{r.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{r.description}</p>
              <div className="mt-4 flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <BarChart3 className="h-3.5 w-3.5" />
                  Visualizar
                </Button>
                <Button variant="ghost" size="sm" className="gap-1.5">
                  <Download className="h-3.5 w-3.5" />
                  Exportar
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
