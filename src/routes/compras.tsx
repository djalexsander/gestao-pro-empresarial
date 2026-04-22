import { createFileRoute } from "@tanstack/react-router";
import { Plus, Search, Eye } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
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
import { formatBRL, recentPurchases } from "@/lib/mock-data";

export const Route = createFileRoute("/compras")({
  head: () => ({
    meta: [
      { title: "Compras — Gestão Pro" },
      { name: "description", content: "Gestão de pedidos de compra e fornecedores." },
    ],
  }),
  component: PurchasesPage,
});

const allPurchases = [
  ...recentPurchases,
  { id: "CMP-0308", fornecedor: "Distribuidora Alfa", valor: 6420.0, status: "Recebido", data: "15/04/2026" },
  { id: "CMP-0307", fornecedor: "Atacado Beta", valor: 1980.0, status: "Recebido", data: "12/04/2026" },
  { id: "CMP-0306", fornecedor: "Importadora Gama", valor: 9320.0, status: "Pendente", data: "10/04/2026" },
];

function PurchasesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Compras"
        description="Pedidos de compra e recebimento de mercadorias."
        actions={
          <Button size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            Nova compra
          </Button>
        }
      />

      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar pedido ou fornecedor..." className="pl-9" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pedido</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead>Data</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {allPurchases.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{p.id}</TableCell>
                  <TableCell className="font-medium">{p.fornecedor}</TableCell>
                  <TableCell className="text-muted-foreground">{p.data}</TableCell>
                  <TableCell className="text-right font-medium">{formatBRL(p.valor)}</TableCell>
                  <TableCell>
                    <StatusBadge status={p.status} />
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
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
