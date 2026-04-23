import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowDownToLine, ArrowUpFromLine, Plus, TrendingUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
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
import { formatBRL } from "@/lib/mock-data";
import { ModuloGate } from "@/components/saas/ModuloGate";
import { supabase } from "@/integrations/supabase/client";

type FinTab = "receber" | "pagar" | "fluxo";

export const Route = createFileRoute("/financeiro")({
  validateSearch: (search: Record<string, unknown>): { tab?: FinTab } => {
    const t = search.tab;
    return t === "pagar" || t === "receber" || t === "fluxo" ? { tab: t } : {};
  },
  head: () => ({
    meta: [
      { title: "Financeiro — Gestão Pro" },
      { name: "description", content: "Contas a pagar, a receber e fluxo de caixa." },
    ],
  }),
  component: FinancePage,
});

type Lancamento = {
  id: string;
  descricao: string;
  valor: number;
  valor_pago: number | null;
  data_vencimento: string;
  data_pagamento: string | null;
  tipo: "receber" | "pagar";
  status: "pendente" | "recebido" | "pago" | "cancelado" | "parcial" | "vencido";
};

function statusLabel(l: Lancamento): string {
  if (l.status === "pago" || l.status === "recebido") return "Pago";
  if (l.status === "cancelado") return "Cancelado";
  if (l.status === "parcial") return "Parcial";
  // pendente: avaliar vencimento
  if (l.data_vencimento && new Date(l.data_vencimento) < new Date(new Date().toDateString())) {
    return "Vencido";
  }
  return "Pendente";
}

function formatDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function FinancePage() {
  return (
    <ModuloGate chave="financeiro_avancado" titulo="Financeiro Avançado">
      <FinanceContent />
    </ModuloGate>
  );
}

function FinanceContent() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const activeTab: FinTab = tab ?? "receber";

  const { data: lancamentos = [], isLoading } = useQuery({
    queryKey: ["financeiro_lancamentos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financeiro_lancamentos")
        .select("id, descricao, valor, valor_pago, data_vencimento, data_pagamento, tipo, status")
        .order("data_vencimento", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Lancamento[];
    },
  });

  const receber = lancamentos.filter(
    (l) => l.tipo === "receber" && l.status !== "recebido" && l.status !== "cancelado",
  );
  const pagar = lancamentos.filter(
    (l) => l.tipo === "pagar" && l.status !== "pago" && l.status !== "cancelado",
  );

  const totalRec = receber.reduce((s, l) => s + Number(l.valor) - Number(l.valor_pago ?? 0), 0);
  const totalPay = pagar.reduce((s, l) => s + Number(l.valor) - Number(l.valor_pago ?? 0), 0);
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
          hint={`${receber.length} títulos`}
        />
        <StatCard
          label="Total a pagar"
          value={formatBRL(totalPay)}
          icon={ArrowUpFromLine}
          iconTone="warning"
          hint={`${pagar.length} títulos`}
        />
        <StatCard
          label="Saldo previsto"
          value={formatBRL(saldo)}
          icon={TrendingUp}
          iconTone={saldo >= 0 ? "success" : "danger"}
        />
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) =>
          navigate({ search: { tab: v === "receber" ? undefined : (v as FinTab) }, replace: true })
        }
      >
        <TabsList>
          <TabsTrigger value="receber">Contas a receber</TabsTrigger>
          <TabsTrigger value="pagar">Contas a pagar</TabsTrigger>
          <TabsTrigger value="fluxo">Fluxo de caixa</TabsTrigger>
        </TabsList>

        <TabsContent value="receber" className="mt-4">
          <LancamentosTable items={receber} loading={isLoading} emptyMsg="Nenhuma conta a receber." />
        </TabsContent>

        <TabsContent value="pagar" className="mt-4">
          <LancamentosTable items={pagar} loading={isLoading} emptyMsg="Nenhuma conta a pagar." />
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

function LancamentosTable({
  items,
  loading,
  emptyMsg,
}: {
  items: Lancamento[];
  loading: boolean;
  emptyMsg: string;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Descrição</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  Carregando…
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  {emptyMsg}
                </TableCell>
              </TableRow>
            ) : (
              items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium">{i.descricao}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(i.data_vencimento)}</TableCell>
                  <TableCell className="text-right font-medium">{formatBRL(Number(i.valor))}</TableCell>
                  <TableCell>
                    <StatusBadge status={statusLabel(i)} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
