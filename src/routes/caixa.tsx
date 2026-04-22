import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Power,
  PowerOff,
  ArrowUpFromLine,
  ArrowDownToLine,
  Wallet,
  Receipt,
  TrendingUp,
  CircleDollarSign,
  CreditCard,
  QrCode,
  Banknote,
  History,
  CheckCircle2,
  Circle,
  Loader2,
  Calculator,
  AlertCircle,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AbrirCaixaDialog } from "@/components/caixa/AbrirCaixaDialog";
import { FecharCaixaDialog } from "@/components/caixa/FecharCaixaDialog";
import { MovimentoCaixaDialog } from "@/components/caixa/MovimentoCaixaDialog";
import {
  useQualquerCaixaAberto,
  useCaixaResumo,
  useCaixasHistorico,
  useCaixaMovimentos,
} from "@/hooks/useCaixa";
import { formatBRL } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth/AuthProvider";
import { useFuncionarios } from "@/hooks/useFuncionarios";

export const Route = createFileRoute("/caixa")({
  head: () => ({
    meta: [
      { title: "Caixa — Gestão Pro" },
      {
        name: "description",
        content:
          "Controle de abertura, operação e fechamento de caixa com conferência por forma de pagamento.",
      },
    ],
  }),
  component: CaixaPage,
});

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const MOVIMENTO_LABEL = {
  abertura: "Abertura",
  venda: "Venda",
  sangria: "Sangria",
  suprimento: "Suprimento",
  fechamento: "Fechamento",
} as const;

function CaixaPage() {
  const { user } = useAuth();
  const { data: caixaAberto, isLoading: loadingCaixa } = useQualquerCaixaAberto();
  const { data: resumo } = useCaixaResumo(caixaAberto?.id);
  const { data: historico = [] } = useCaixasHistorico(20);
  const { data: movimentos = [] } = useCaixaMovimentos(caixaAberto?.id);
  const { data: funcionarios = [] } = useFuncionarios();

  const operadorNome = caixaAberto?.operador_id
    ? funcionarios.find((f) => f.id === caixaAberto.operador_id)?.nome ?? "Operador"
    : user?.email ?? "—";

  const [abrirOpen, setAbrirOpen] = useState(false);
  const [fecharOpen, setFecharOpen] = useState(false);
  const [movDialog, setMovDialog] = useState<null | "sangria" | "suprimento">(null);

  if (loadingCaixa) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Caixa"
        description="Controle de abertura, operação e fechamento do caixa."
        actions={
          caixaAberto ? (
            <>
              <Badge className="border-success/30 bg-success/15 text-success">
                <CheckCircle2 className="mr-1 h-3 w-3" /> Caixa aberto
              </Badge>
              <Button asChild variant="outline">
                <Link to="/pdv">
                  <Receipt className="h-4 w-4" /> Ir para o PDV
                </Link>
              </Button>
              <Button
                variant="destructive"
                onClick={() => setFecharOpen(true)}
              >
                <PowerOff className="h-4 w-4" /> Fechar caixa
              </Button>
            </>
          ) : (
            <>
              <Badge variant="outline" className="text-muted-foreground">
                <Circle className="mr-1 h-3 w-3" /> Nenhum caixa aberto
              </Badge>
              <Button onClick={() => setAbrirOpen(true)}>
                <Power className="h-4 w-4" /> Abrir caixa
              </Button>
            </>
          )
        }
      />

      {!caixaAberto ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Wallet}
              title="Nenhum caixa aberto"
              description="Você precisa abrir o caixa antes de iniciar as vendas no PDV. O sistema vai bloquear a finalização de vendas enquanto não houver um caixa aberto."
              action={
                <Button onClick={() => setAbrirOpen(true)}>
                  <Power className="h-4 w-4" /> Abrir caixa agora
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Cabeçalho do turno */}
          <Card>
            <CardContent className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
              <InfoCol label="Operador" value={operadorNome} icon={CircleDollarSign} />
              <InfoCol
                label="Aberto em"
                value={formatDateTime(caixaAberto.data_abertura)}
                icon={Power}
              />
              <InfoCol
                label="Valor inicial"
                value={formatBRL(caixaAberto.valor_inicial)}
                icon={Banknote}
              />
              <InfoCol
                label="Vendas no turno"
                value={String(resumo?.qtd_vendas ?? 0)}
                icon={Receipt}
              />
            </CardContent>
          </Card>

          {/* Stat cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Total vendido"
              value={formatBRL(resumo?.total_vendas ?? 0)}
              icon={TrendingUp}
              iconTone="primary"
              hint={`${resumo?.qtd_vendas ?? 0} vendas`}
            />
            <StatCard
              label="Esperado em dinheiro"
              value={formatBRL(resumo?.valor_esperado ?? 0)}
              icon={Calculator}
              iconTone="success"
              hint="inicial + dinheiro + suprim. − sangrias"
            />
            <StatCard
              label="Suprimentos"
              value={formatBRL(resumo?.total_suprimentos ?? 0)}
              icon={ArrowDownToLine}
              iconTone="info"
            />
            <StatCard
              label="Sangrias"
              value={formatBRL(resumo?.total_sangrias ?? 0)}
              icon={ArrowUpFromLine}
              iconTone="danger"
            />
          </div>

          {/* Totais por forma de pagamento + ações */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardContent className="p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">
                    Recebido por forma de pagamento
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    Apenas valores efetivamente recebidos
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormaRow icon={Banknote} label="Dinheiro" value={resumo?.total_dinheiro ?? 0} highlight />
                  <FormaRow icon={QrCode} label="PIX" value={resumo?.total_pix ?? 0} />
                  <FormaRow icon={CreditCard} label="Cartão débito" value={resumo?.total_debito ?? 0} />
                  <FormaRow icon={CreditCard} label="Cartão crédito" value={resumo?.total_credito ?? 0} />
                  <FormaRow icon={Receipt} label="Boleto" value={resumo?.total_boleto ?? 0} />
                  {(resumo?.total_outros ?? 0) > 0 && (
                    <FormaRow icon={Wallet} label="Outros" value={resumo?.total_outros ?? 0} />
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-3 p-5">
                <h3 className="text-sm font-semibold text-foreground">Operações de caixa</h3>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => setMovDialog("suprimento")}
                >
                  <ArrowDownToLine className="h-4 w-4 text-success" />
                  Suprimento (entrar dinheiro)
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => setMovDialog("sangria")}
                >
                  <ArrowUpFromLine className="h-4 w-4 text-destructive" />
                  Sangria (retirar dinheiro)
                </Button>
                <div className="rounded-md border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground">
                  <p className="flex items-start gap-1.5">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
                    Vendas pendentes ou parciais entram no caixa apenas pelo valor já recebido.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Movimentos do turno */}
          <Card>
            <CardContent className="p-0">
              <div className="flex items-center justify-between border-b border-border p-4">
                <h3 className="text-sm font-semibold text-foreground">
                  Movimentos do turno ({movimentos.length})
                </h3>
              </div>
              {movimentos.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Nenhum movimento registrado ainda.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Quando</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...movimentos].reverse().map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatDateTime(m.created_at)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              "capitalize",
                              m.tipo === "abertura" && "border-info/40 bg-info/10 text-info",
                              m.tipo === "venda" && "border-primary/40 bg-primary/10 text-primary",
                              m.tipo === "sangria" && "border-destructive/40 bg-destructive/10 text-destructive",
                              m.tipo === "suprimento" && "border-success/40 bg-success/15 text-success",
                              m.tipo === "fechamento" && "border-border bg-muted text-foreground",
                            )}
                          >
                            {MOVIMENTO_LABEL[m.tipo]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {m.motivo ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatBRL(m.valor)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Histórico */}
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center gap-2 border-b border-border p-4">
            <History className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Histórico de caixas</h3>
          </div>
          {historico.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Nenhum caixa registrado ainda.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Abertura</TableHead>
                  <TableHead>Fechamento</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Vendas</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Diferença</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historico.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-sm">{formatDateTime(c.data_abertura)}</TableCell>
                    <TableCell className="text-sm">{formatDateTime(c.data_fechamento)}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          c.status === "aberto"
                            ? "border-success/40 bg-success/15 text-success"
                            : "border-border bg-muted text-muted-foreground",
                        )}
                      >
                        {c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{c.qtd_vendas}</TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">
                      {formatBRL(c.total_vendas)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono text-sm tabular-nums",
                        c.diferenca === null && "text-muted-foreground",
                        c.diferenca !== null && Math.abs(c.diferenca) < 0.009 && "text-success",
                        c.diferenca !== null && Math.abs(c.diferenca) >= 0.009 && "text-destructive",
                      )}
                    >
                      {c.diferenca === null ? "—" : (c.diferenca > 0 ? "+" : "") + formatBRL(c.diferenca)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AbrirCaixaDialog open={abrirOpen} onOpenChange={setAbrirOpen} />
      {caixaAberto && (
        <>
          <FecharCaixaDialog
            open={fecharOpen}
            onOpenChange={setFecharOpen}
            caixaId={caixaAberto.id}
            resumo={resumo ?? null}
          />
          {movDialog && (
            <MovimentoCaixaDialog
              open={!!movDialog}
              onOpenChange={(o) => !o && setMovDialog(null)}
              caixaId={caixaAberto.id}
              tipo={movDialog}
            />
          )}
        </>
      )}
    </div>
  );
}

function InfoCol({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Wallet;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium text-foreground">{value}</p>
      </div>
    </div>
  );
}

function FormaRow({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: typeof Wallet;
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-md border border-border p-3",
        highlight && "border-success/30 bg-success/5",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", highlight ? "text-success" : "text-muted-foreground")} />
        <span className="text-sm text-foreground">{label}</span>
      </div>
      <span
        className={cn(
          "font-mono text-sm font-semibold tabular-nums",
          highlight ? "text-success" : "text-foreground",
        )}
      >
        {formatBRL(value)}
      </span>
    </div>
  );
}
