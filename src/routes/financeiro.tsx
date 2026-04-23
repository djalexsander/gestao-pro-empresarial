import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownToLine, ArrowUpFromLine, Plus, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { accountsPayable, accountsReceivable, formatBRL } from "@/lib/mock-data";
import { ModuloGate } from "@/components/saas/ModuloGate";

export const Route = createFileRoute("/financeiro")({
  head: () => ({
    meta: [
      { title: "Financeiro — Gestão Pro" },
      { name: "description", content: "Contas a pagar, a receber e fluxo de caixa." },
    ],
  }),
  component: FinancePage,
});

function FinancePage() {
  return (
    <ModuloGate chave="financeiro_avancado" titulo="Financeiro Avançado">
      <FinanceContent />
    </ModuloGate>
  );
}

function FinanceContent() {
  const totalPay = accountsPayable.reduce((s, i) => s + i.valor, 0);
  const totalRec = accountsReceivable.reduce((s, i) => s + i.valor, 0);
  const saldo = totalRec - totalPay;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financeiro"
        description="Acompanhe entradas, saídas e o fluxo de caixa."
        actions={
          <Button size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            Novo lançamento
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Total a receber"
          value={formatBRL(totalRec)}
          icon={ArrowDownToLine}
          iconTone="success"
          hint={`${accountsReceivable.length} títulos`}
        />
        <StatCard
          label="Total a pagar"
          value={formatBRL(totalPay)}
          icon={ArrowUpFromLine}
          iconTone="warning"
          hint={`${accountsPayable.length} títulos`}
        />
        <StatCard
          label="Saldo previsto"
          value={formatBRL(saldo)}
          icon={TrendingUp}
          iconTone={saldo >= 0 ? "success" : "danger"}
        />
      </div>

      <Tabs defaultValue="receber">
        <TabsList>
          <TabsTrigger value="receber">Contas a receber</TabsTrigger>
          <TabsTrigger value="pagar">Contas a pagar</TabsTrigger>
          <TabsTrigger value="fluxo">Fluxo de caixa</TabsTrigger>
        </TabsList>

        <TabsContent value="receber" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accountsReceivable.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">{i.id}</TableCell>
                      <TableCell className="font-medium">{i.descricao}</TableCell>
                      <TableCell className="text-muted-foreground">{i.vencimento}</TableCell>
                      <TableCell className="text-right font-medium">{formatBRL(i.valor)}</TableCell>
                      <TableCell>
                        <StatusBadge status={i.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pagar" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accountsPayable.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">{i.id}</TableCell>
                      <TableCell className="font-medium">{i.descricao}</TableCell>
                      <TableCell className="text-muted-foreground">{i.vencimento}</TableCell>
                      <TableCell className="text-right font-medium">{formatBRL(i.valor)}</TableCell>
                      <TableCell>
                        <StatusBadge status={i.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="fluxo" className="mt-4">
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <p className="text-sm">Visualização de fluxo de caixa em construção.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
