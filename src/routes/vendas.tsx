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
import { formatBRL, recentSales } from "@/lib/mock-data";

export const Route = createFileRoute("/vendas")({
  head: () => ({
    meta: [
      { title: "Vendas — Gestão Pro" },
      { name: "description", content: "Pedidos de venda e atendimento a clientes." },
    ],
  }),
  component: SalesPage,
});

const allSales = [
  ...recentSales,
  { id: "VND-1037", cliente: "Restaurante Sabor", valor: 1542.0, status: "Pago", data: "19/04/2026" },
  { id: "VND-1036", cliente: "Mercearia Central", valor: 822.5, status: "Pago", data: "18/04/2026" },
  { id: "VND-1035", cliente: "Mini Box Família", valor: 1820.7, status: "Pendente", data: "17/04/2026" },
];

function SalesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Vendas"
        description="Pedidos de venda registrados no sistema."
        actions={
          <Button size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            Nova venda
          </Button>
        }
      />

      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar pedido ou cliente..." className="pl-9" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pedido</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Data</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {allSales.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{s.id}</TableCell>
                  <TableCell className="font-medium">{s.cliente}</TableCell>
                  <TableCell className="text-muted-foreground">{s.data}</TableCell>
                  <TableCell className="text-right font-medium">{formatBRL(s.valor)}</TableCell>
                  <TableCell>
                    <StatusBadge status={s.status} />
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
