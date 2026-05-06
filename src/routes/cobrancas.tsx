import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  QrCode,
  ExternalLink,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  Receipt,
  Loader2,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  CobrancaPixDialog,
  type CobrancaResult,
} from "@/components/saas/CobrancaPixDialog";

export const Route = createFileRoute("/cobrancas")({
  head: () => ({
    meta: [
      { title: "Cobranças e faturas — Gestão Pro" },
      {
        name: "description",
        content:
          "Acompanhe suas cobranças, faturas, status de pagamento e pague pendências por Pix.",
      },
    ],
  }),
  component: CobrancasPage,
});

type PagamentoRow = {
  id: string;
  referencia_tipo: "plano" | "modulo" | "consolidado" | string;
  descricao: string | null;
  valor: number;
  status: "pendente" | "pago" | "cancelado" | "estornado" | string;
  data_vencimento: string | null;
  data_pagamento: string | null;
  created_at: string;
  asaas_payment_id: string | null;
  asaas_invoice_url: string | null;
  asaas_pix_qrcode: string | null;
  asaas_pix_copia_cola: string | null;
  asaas_billing_type: string | null;
};

const fmtBRL = (n: number) =>
  Number(n ?? 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";

const STATUS_META: Record<
  string,
  { label: string; tone: string; icon: typeof CheckCircle2 }
> = {
  pendente: {
    label: "Pendente",
    tone: "bg-amber-500/15 text-amber-800 dark:text-amber-200 border-amber-500/30",
    icon: Clock,
  },
  pago: {
    label: "Pago",
    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    icon: CheckCircle2,
  },
  cancelado: {
    label: "Cancelado",
    tone: "bg-muted text-muted-foreground border-border",
    icon: XCircle,
  },
  estornado: {
    label: "Estornado",
    tone: "bg-muted text-muted-foreground border-border",
    icon: XCircle,
  },
};

const REF_LABEL: Record<string, string> = {
  plano: "Plano",
  modulo: "Módulo",
  consolidado: "Consolidado",
};

function isVencido(p: PagamentoRow): boolean {
  if (p.status !== "pendente" || !p.data_vencimento) return false;
  return new Date(p.data_vencimento + "T23:59:59") < new Date();
}

function usePagamentosEmpresa() {
  return useQuery({
    queryKey: ["meus-pagamentos"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pagamentos")
        .select(
          "id, referencia_tipo, descricao, valor, status, data_vencimento, data_pagamento, created_at, asaas_payment_id, asaas_invoice_url, asaas_pix_qrcode, asaas_pix_copia_cola, asaas_billing_type",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as PagamentoRow[];
    },
  });
}

function CobrancasPage() {
  const { data: pagamentos = [], isLoading } = usePagamentosEmpresa();
  const [pixOpen, setPixOpen] = useState(false);
  const [pixCobranca, setPixCobranca] = useState<CobrancaResult | null>(null);

  const grupos = useMemo(() => {
    const pendentes: PagamentoRow[] = [];
    const pagos: PagamentoRow[] = [];
    const outros: PagamentoRow[] = [];
    for (const p of pagamentos) {
      if (p.status === "pendente") pendentes.push(p);
      else if (p.status === "pago") pagos.push(p);
      else outros.push(p);
    }
    return { pendentes, pagos, outros };
  }, [pagamentos]);

  const totalPendente = grupos.pendentes.reduce(
    (s, p) => s + Number(p.valor || 0),
    0,
  );

  const handlePagar = (p: PagamentoRow) => {
    setPixCobranca({
      pagamento_id: p.id,
      asaas_payment_id: p.asaas_payment_id ?? "",
      invoice_url: p.asaas_invoice_url,
      pix_qrcode: p.asaas_pix_qrcode,
      pix_copia_cola: p.asaas_pix_copia_cola,
      due_date: p.data_vencimento,
    });
    setPixOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cobranças e faturas"
        description="Acompanhe suas cobranças, baixe faturas e pague pendências por Pix."
        actions={
          <Button asChild variant="outline">
            <Link to="/planos">
              <Receipt className="mr-2 h-4 w-4" /> Ver planos
            </Link>
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Total pendente
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{fmtBRL(totalPendente)}</p>
            <p className="text-xs text-muted-foreground">
              {grupos.pendentes.length} cobrança(s) em aberto
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Pagas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{grupos.pagos.length}</p>
            <p className="text-xs text-muted-foreground">faturas confirmadas</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Total emitido
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{pagamentos.length}</p>
            <p className="text-xs text-muted-foreground">cobranças no histórico</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4 sm:p-6">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : pagamentos.length === 0 ? (
            <EmptyState />
          ) : (
            <Tabs defaultValue="pendentes" className="space-y-4">
              <TabsList>
                <TabsTrigger value="pendentes">
                  Pendentes ({grupos.pendentes.length})
                </TabsTrigger>
                <TabsTrigger value="pagas">
                  Pagas ({grupos.pagos.length})
                </TabsTrigger>
                <TabsTrigger value="todas">
                  Todas ({pagamentos.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="pendentes">
                <CobrancasTable
                  rows={grupos.pendentes}
                  onPagar={handlePagar}
                  emptyText="Nenhuma cobrança pendente. 🎉"
                />
              </TabsContent>
              <TabsContent value="pagas">
                <CobrancasTable
                  rows={grupos.pagos}
                  onPagar={handlePagar}
                  emptyText="Nenhuma cobrança paga ainda."
                />
              </TabsContent>
              <TabsContent value="todas">
                <CobrancasTable
                  rows={pagamentos}
                  onPagar={handlePagar}
                  emptyText="Nenhum lançamento."
                />
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>

      <CobrancaPixDialog
        open={pixOpen}
        onOpenChange={setPixOpen}
        cobranca={pixCobranca}
      />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
      <div className="rounded-full bg-muted p-3">
        <Receipt className="h-6 w-6 text-muted-foreground" />
      </div>
      <div>
        <p className="font-medium">Nenhuma cobrança ainda</p>
        <p className="text-sm text-muted-foreground">
          Quando você contratar um plano ou módulo, as faturas aparecerão aqui.
        </p>
      </div>
      <Button asChild>
        <Link to="/planos">Ver planos disponíveis</Link>
      </Button>
    </div>
  );
}

function CobrancasTable({
  rows,
  onPagar,
  emptyText,
}: {
  rows: PagamentoRow[];
  onPagar: (p: PagamentoRow) => void;
  emptyText: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {emptyText}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Descrição</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Vencimento</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Valor</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p) => {
            const meta = STATUS_META[p.status] ?? STATUS_META.pendente;
            const Icon = meta.icon;
            const vencido = isVencido(p);
            const podeCobrar =
              p.status === "pendente" &&
              (!!p.asaas_pix_qrcode ||
                !!p.asaas_pix_copia_cola ||
                !!p.asaas_invoice_url);

            return (
              <TableRow key={p.id}>
                <TableCell className="max-w-xs">
                  <p className="truncate font-medium">
                    {p.descricao ?? "Cobrança"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Emitida em {fmtDate(p.created_at)}
                  </p>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {REF_LABEL[p.referencia_tipo] ?? p.referencia_tipo}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span>{fmtDate(p.data_vencimento)}</span>
                    {vencido && (
                      <Badge
                        variant="outline"
                        className="gap-1 border-orange-500/30 bg-orange-500/15 text-orange-800 dark:text-orange-200"
                      >
                        <AlertTriangle className="h-3 w-3" /> Vencida
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={`gap-1 ${meta.tone}`}>
                    <Icon className="h-3.5 w-3.5" />
                    {meta.label}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-medium">
                  {fmtBRL(p.valor)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {podeCobrar && (
                      <Button size="sm" onClick={() => onPagar(p)}>
                        <QrCode className="mr-2 h-3.5 w-3.5" />
                        Pagar
                      </Button>
                    )}
                    {p.asaas_invoice_url && (
                      <Button
                        size="sm"
                        variant="outline"
                        asChild
                      >
                        <a
                          href={p.asaas_invoice_url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="Abrir fatura"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
