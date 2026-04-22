import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownUp, AlertTriangle, Boxes, PackageX, Search } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { StatCard } from "@/components/shared/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { stockItems } from "@/lib/mock-data";

export const Route = createFileRoute("/estoque")({
  head: () => ({
    meta: [
      { title: "Estoque — Gestão Pro" },
      { name: "description", content: "Controle e movimentação de estoque." },
    ],
  }),
  component: StockPage,
});

function StockPage() {
  const total = stockItems.length;
  const low = stockItems.filter((i) => i.situacao === "Baixo" || i.situacao === "Crítico").length;
  const out = stockItems.filter((i) => i.situacao === "Esgotado").length;
  const totalUnits = stockItems.reduce((s, i) => s + i.estoque, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Estoque"
        description="Acompanhe os níveis de estoque e movimentações."
        actions={
          <Button size="sm" className="gap-1.5">
            <ArrowDownUp className="h-4 w-4" />
            Nova movimentação
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="SKUs ativos" value={String(total)} icon={Boxes} iconTone="primary" />
        <StatCard label="Unidades em estoque" value={String(totalUnits)} icon={Boxes} iconTone="info" />
        <StatCard label="Estoque baixo" value={String(low)} icon={AlertTriangle} iconTone="warning" />
        <StatCard label="Esgotados" value={String(out)} icon={PackageX} iconTone="danger" />
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar produto..." className="pl-9" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead className="text-right">Estoque atual</TableHead>
                <TableHead className="text-right">Mínimo</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stockItems.map((i) => (
                <TableRow key={i.sku}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{i.sku}</TableCell>
                  <TableCell className="font-medium">{i.nome}</TableCell>
                  <TableCell>
                    <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {i.categoria}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{i.estoque}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{i.minimo}</TableCell>
                  <TableCell>
                    <StatusBadge status={i.situacao} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
