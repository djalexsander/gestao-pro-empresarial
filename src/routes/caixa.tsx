import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
  Trash2,
  ChevronDown,
  ChevronRight,
  CalendarDays,
  Search,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AbrirCaixaDialog } from "@/components/caixa/AbrirCaixaDialog";
import { FecharCaixaDialog } from "@/components/caixa/FecharCaixaDialog";
import { MovimentoCaixaDialog } from "@/components/caixa/MovimentoCaixaDialog";
import {
  useQualquerCaixaAberto,
  useCaixaResumo,
  useCaixasHistorico,
  useCaixaMovimentos,
  useExcluirCaixa,
  type Caixa,
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
  const { data: historico = [] } = useCaixasHistorico(500);
  const { data: movimentos = [] } = useCaixaMovimentos(caixaAberto?.id);
  const { data: funcionarios = [] } = useFuncionarios();
  const excluirCaixaMutation = useExcluirCaixa();

  const operadorNome = caixaAberto?.operador_id
    ? funcionarios.find((f) => f.id === caixaAberto.operador_id)?.nome ?? "Operador"
    : user?.email ?? "—";

  const [abrirOpen, setAbrirOpen] = useState(false);
  const [fecharOpen, setFecharOpen] = useState(false);
  const [movDialog, setMovDialog] = useState<null | "sangria" | "suprimento">(null);
  const [excluirCaixa, setExcluirCaixa] = useState<Caixa | null>(null);
  const [buscaHist, setBuscaHist] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [diasAbertos, setDiasAbertos] = useState<Record<string, boolean>>({});

  // Agrupamento do histórico por data (com filtros)
  const historicoFiltrado = useMemo(() => {
    const q = buscaHist.trim().toLowerCase();
    return historico.filter((c) => {
      const dia = c.data_abertura.slice(0, 10);
      if (dataInicio && dia < dataInicio) return false;
      if (dataFim && dia > dataFim) return false;
      if (!q) return true;
      const operador = c.operador_id
        ? funcionarios.find((f) => f.id === c.operador_id)?.nome?.toLowerCase() ?? ""
        : "";
      return (
        operador.includes(q) ||
        (c.observacao ?? "").toLowerCase().includes(q) ||
        c.status.toLowerCase().includes(q)
      );
    });
  }, [historico, buscaHist, dataInicio, dataFim, funcionarios]);

  const gruposPorDia = useMemo(() => {
    const mapa = new Map<string, Caixa[]>();
    for (const c of historicoFiltrado) {
      const dia = c.data_abertura.slice(0, 10);
      if (!mapa.has(dia)) mapa.set(dia, []);
      mapa.get(dia)!.push(c);
    }
    return Array.from(mapa.entries())
      .map(([dia, caixas]) => {
        const totalVendas = caixas.reduce((s, c) => s + (Number(c.total_vendas) || 0), 0);
        const totalQtd = caixas.reduce((s, c) => s + (Number(c.qtd_vendas) || 0), 0);
        const abertos = caixas.filter((c) => c.status === "aberto").length;
        return { dia, caixas, totalVendas, totalQtd, abertos };
      })
      .sort((a, b) => (a.dia < b.dia ? 1 : -1));
  }, [historicoFiltrado]);

  function toggleDia(dia: string) {
    setDiasAbertos((prev) => ({ ...prev, [dia]: !prev[dia] }));
  }

  function formatarDia(dia: string) {
    const d = new Date(dia + "T00:00:00");
    return d.toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  }

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
              label="Suprimentos (entrou na gaveta)"
              value={formatBRL(resumo?.total_suprimentos ?? 0)}
              icon={ArrowDownToLine}
              iconTone="info"
              hint="Reforço de dinheiro físico — não é venda"
            />
            <StatCard
              label="Sangrias (saiu da gaveta)"
              value={formatBRL(resumo?.total_sangrias ?? 0)}
              icon={ArrowUpFromLine}
              iconTone="danger"
              hint="Retirada de dinheiro físico — não é despesa"
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
                <p className="text-xs text-muted-foreground">
                  Movimentos físicos de dinheiro na gaveta. Não são vendas, despesas, lucro nem investimento.
                </p>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => setMovDialog("suprimento")}
                  title="Adicionar dinheiro físico ao caixa (reforço de troco)"
                >
                  <ArrowDownToLine className="h-4 w-4 text-success" />
                  Suprimento — adicionar dinheiro
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => setMovDialog("sangria")}
                  title="Retirar dinheiro físico do caixa (envio ao cofre, troca de notas)"
                >
                  <ArrowUpFromLine className="h-4 w-4 text-destructive" />
                  Sangria — retirar dinheiro
                </Button>
                <div className="rounded-md border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground">
                  <p className="flex items-start gap-1.5">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
                    Suprimento e sangria afetam apenas o dinheiro esperado na gaveta — não distorcem faturamento, lucro ou contas a pagar/receber.
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

      {/* Histórico agrupado por data */}
      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">
                Histórico de caixas
              </h3>
              <Badge variant="outline" className="text-xs text-muted-foreground">
                {historicoFiltrado.length} {historicoFiltrado.length === 1 ? "caixa" : "caixas"}
              </Badge>
            </div>
          </div>

          {/* Filtros */}
          <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative lg:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por operador, status ou observação..."
                className="pl-9"
                value={buscaHist}
                onChange={(e) => setBuscaHist(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <Input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                aria-label="Data inicial"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">até</span>
              <Input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                aria-label="Data final"
              />
              {(dataInicio || dataFim || buscaHist) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDataInicio("");
                    setDataFim("");
                    setBuscaHist("");
                  }}
                >
                  Limpar
                </Button>
              )}
            </div>
          </div>

          {gruposPorDia.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {historico.length === 0
                ? "Nenhum caixa registrado ainda."
                : "Nenhum caixa encontrado para os filtros aplicados."}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {gruposPorDia.map((grupo) => {
                const aberto = diasAbertos[grupo.dia] ?? false;
                return (
                  <div key={grupo.dia}>
                    <button
                      type="button"
                      onClick={() => toggleDia(grupo.dia)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                    >
                      <div className="flex items-center gap-2">
                        {aberto ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="text-sm font-medium capitalize text-foreground">
                          {formatarDia(grupo.dia)}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {grupo.caixas.length}{" "}
                          {grupo.caixas.length === 1 ? "caixa" : "caixas"}
                        </Badge>
                        {grupo.abertos > 0 && (
                          <Badge className="border-success/30 bg-success/15 text-xs text-success">
                            {grupo.abertos} aberto{grupo.abertos > 1 ? "s" : ""}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>
                          <span className="text-foreground tabular-nums">
                            {grupo.totalQtd}
                          </span>{" "}
                          vendas
                        </span>
                        <span className="font-mono text-foreground tabular-nums">
                          {formatBRL(grupo.totalVendas)}
                        </span>
                      </div>
                    </button>

                    {aberto && (
                      <div className="bg-muted/20 px-2 pb-3">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Abertura</TableHead>
                              <TableHead>Fechamento</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead className="text-right">Vendas</TableHead>
                              <TableHead className="text-right">Total</TableHead>
                              <TableHead className="text-right">Diferença</TableHead>
                              <TableHead className="w-12 text-right" />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {grupo.caixas.map((c) => (
                              <TableRow key={c.id}>
                                <TableCell className="text-sm">
                                  {formatDateTime(c.data_abertura)}
                                </TableCell>
                                <TableCell className="text-sm">
                                  {formatDateTime(c.data_fechamento)}
                                </TableCell>
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
                                <TableCell className="text-right text-sm tabular-nums">
                                  {c.qtd_vendas}
                                </TableCell>
                                <TableCell className="text-right font-mono text-sm tabular-nums">
                                  {formatBRL(c.total_vendas)}
                                </TableCell>
                                <TableCell
                                  className={cn(
                                    "text-right font-mono text-sm tabular-nums",
                                    c.diferenca === null && "text-muted-foreground",
                                    c.diferenca !== null &&
                                      Math.abs(c.diferenca) < 0.009 &&
                                      "text-success",
                                    c.diferenca !== null &&
                                      Math.abs(c.diferenca) >= 0.009 &&
                                      "text-destructive",
                                  )}
                                >
                                  {c.diferenca === null
                                    ? "—"
                                    : (c.diferenca > 0 ? "+" : "") +
                                      formatBRL(c.diferenca)}
                                </TableCell>
                                <TableCell className="text-right">
                                  {c.status === "fechado" && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                      onClick={() => setExcluirCaixa(c)}
                                      title="Excluir caixa do histórico"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={excluirCaixa !== null}
        onOpenChange={(o) => !o && setExcluirCaixa(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir caixa do histórico?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é <strong>permanente</strong>. Os movimentos do caixa
              (sangrias, suprimentos, abertura e fechamento) serão removidos. As
              vendas vinculadas serão preservadas, apenas desvinculadas deste
              caixa.
              <br />
              <br />
              <span className="text-foreground">
                Caixa aberto em{" "}
                <strong>{formatDateTime(excluirCaixa?.data_abertura ?? null)}</strong>
                {excluirCaixa?.qtd_vendas
                  ? ` • ${excluirCaixa.qtd_vendas} vendas (${formatBRL(excluirCaixa.total_vendas)})`
                  : ""}
                .
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluirCaixaMutation.isPending}>
              Voltar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={excluirCaixaMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (e) => {
                e.preventDefault();
                if (!excluirCaixa) return;
                try {
                  await excluirCaixaMutation.mutateAsync(excluirCaixa.id);
                  setExcluirCaixa(null);
                } catch {
                  /* toast já mostrado pelo hook */
                }
              }}
            >
              {excluirCaixaMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Excluindo...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Excluir caixa
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
