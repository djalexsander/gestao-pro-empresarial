import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Sparkles,
  Crown,
  Lock,
  Check,
  Loader2,
  Receipt,
  CalendarClock,
  AlertTriangle,
  ExternalLink,
  Plus,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useEmpresaAtual } from "@/hooks/useEmpresa";
import {
  useMeusModulos,
  useMinhaAssinatura,
  type MeuModulo,
} from "@/hooks/useSaasAdmin";
import {
  useModulosDisponiveisCliente,
  usePlanosDisponiveis,
  useSolicitarModulo,
  type ModuloDisponivelCliente,
} from "@/hooks/useSaasCliente";

/* =========================================================
 * Helpers
 * =======================================================*/
const fmtBRL = (n: number) =>
  Number(n ?? 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

const fmtDate = (d?: string | null) => {
  if (!d) return "—";
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("pt-BR");
};

const tipoCobrancaLabel: Record<string, string> = {
  mensal: "/mês",
  anual: "/ano",
  vitalicio: " (vitalício)",
};

const statusAssinaturaTone: Record<string, string> = {
  ativo: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30 dark:text-emerald-400",
  trial: "bg-amber-400/10 text-amber-700 border-amber-400/30 dark:text-amber-300",
  vencido: "bg-destructive/10 text-destructive border-destructive/30",
  cancelado: "bg-muted text-muted-foreground border-border",
};

const statusAssinaturaLabel: Record<string, string> = {
  ativo: "Ativo",
  trial: "Período de teste",
  vencido: "Vencido",
  cancelado: "Cancelado",
};

const statusPagamentoTone: Record<string, string> = {
  pago: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30 dark:text-emerald-400",
  pendente: "bg-amber-400/10 text-amber-700 border-amber-400/30 dark:text-amber-300",
  atrasado: "bg-destructive/10 text-destructive border-destructive/30",
  cancelado: "bg-muted text-muted-foreground border-border",
};

const statusPagamentoLabel: Record<string, string> = {
  pago: "Pago",
  pendente: "Pendente",
  atrasado: "Atrasado",
  cancelado: "Cancelado",
};

/* =========================================================
 * Pagamentos da empresa (SELECT direto — RLS protege)
 * =======================================================*/
type PagamentoCliente = {
  id: string;
  referencia_tipo: string;
  descricao: string | null;
  valor: number;
  status: string;
  forma_pagamento: string | null;
  data_vencimento: string | null;
  data_pagamento: string | null;
  created_at: string;
  plano: { nome: string } | null;
  modulo: { nome: string } | null;
};

function useMeusPagamentos(empresaId?: string | null) {
  return useQuery({
    queryKey: ["meus-pagamentos", empresaId ?? "none"],
    enabled: !!empresaId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pagamentos")
        .select(
          `id, referencia_tipo, descricao, valor, status, forma_pagamento,
           data_vencimento, data_pagamento, created_at,
           plano:plano_id (nome),
           modulo:modulo_id (nome)`,
        )
        .eq("empresa_id", empresaId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as PagamentoCliente[];
    },
  });
}

/* =========================================================
 * Componente principal
 * =======================================================*/
export function PlanosModulosTab() {
  const { empresaAtual } = useEmpresaAtual();
  const { data: assinatura, isLoading: loadingAss } = useMinhaAssinatura();
  const { data: meusModulos = [], isLoading: loadingMods } = useMeusModulos();
  const { data: planos = [], isLoading: loadingPlanos } = usePlanosDisponiveis();
  const { data: modulosDisp = [], isLoading: loadingModsDisp } =
    useModulosDisponiveisCliente();
  const { data: pagamentos = [], isLoading: loadingPag } = useMeusPagamentos(
    empresaAtual?.id,
  );

  /* ---- Plano atual ---- */
  const planoAtual = useMemo(
    () => planos.find((p) => p.atual) ?? null,
    [planos],
  );

  /* ---- Mensalidade: plano base + módulos ativos ---- */
  const composicao = useMemo(() => {
    const valorPlano = Number(planoAtual?.valor ?? 0);
    const tipo = planoAtual?.tipo_cobranca ?? "mensal";
    // Apenas módulos efetivamente contratados/ativos (não trial e não "sem restrição")
    const ativos = meusModulos.filter((m) => m.origem === "ativo");
    const valorModulos = ativos.reduce((sum, m) => sum + Number(m.valor ?? 0), 0);
    return {
      plano: valorPlano,
      tipo,
      modulos: ativos,
      valorModulos,
      total: valorPlano + valorModulos,
    };
  }, [planoAtual, meusModulos]);

  if (loadingAss || loadingMods) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (assinatura?.sem_empresa) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Nenhuma empresa ativa para exibir plano.
        </CardContent>
      </Card>
    );
  }

  const status = assinatura?.status ?? "trial";
  const tone = statusAssinaturaTone[status] ?? statusAssinaturaTone.trial;
  const statusLabel = statusAssinaturaLabel[status] ?? status;

  return (
    <div className="space-y-6">
      {/* Banner de status crítico */}
      {assinatura?.readonly && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Sistema em modo somente-leitura</p>
            <p className="mt-1 text-destructive/90">
              Sua assinatura está {statusLabel.toLowerCase()}. Regularize o
              pagamento para voltar a operar normalmente.
            </p>
          </div>
        </div>
      )}

      {/* ============================================================
          HEADER: plano atual + status + mensalidade
         ============================================================ */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Plano atual */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Plano atual
                </p>
                <CardTitle className="mt-1 flex items-center gap-2 text-2xl">
                  {planoAtual?.nome ?? "Sem plano contratado"}
                  {planoAtual && <Crown className="h-5 w-5 text-amber-500" />}
                </CardTitle>
                {planoAtual?.descricao && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {planoAtual.descricao}
                  </p>
                )}
              </div>
              <Badge
                variant="outline"
                className={`shrink-0 border ${tone}`}
              >
                {statusLabel}
                {status === "trial" &&
                  (assinatura?.dias_restantes ?? 0) >= 0 && (
                    <span className="ml-1 font-normal opacity-80">
                      · {assinatura?.dias_restantes}d
                    </span>
                  )}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <InfoCell
                icon={<CalendarClock className="h-4 w-4" />}
                label="Início"
                value={fmtDate(assinatura?.data_inicio)}
              />
              <InfoCell
                icon={<CalendarClock className="h-4 w-4" />}
                label={
                  status === "trial" ? "Trial expira em" : "Próximo vencimento"
                }
                value={fmtDate(assinatura?.data_expiracao)}
              />
              <InfoCell
                icon={<Sparkles className="h-4 w-4" />}
                label="Módulos ativos"
                value={String(
                  meusModulos.filter((m) => m.origem === "ativo").length,
                )}
              />
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/planos">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  {planoAtual ? "Trocar de plano" : "Escolher plano"}
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/modulos">
                  <Plus className="mr-2 h-4 w-4" />
                  Ver todos os módulos
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Resumo da mensalidade */}
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Mensalidade total
            </p>
            <CardTitle className="mt-1 text-3xl tracking-tight">
              {fmtBRL(composicao.total)}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                {tipoCobrancaLabel[composicao.tipo] ?? ""}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <CompLine
              label={`Plano ${planoAtual?.nome ?? "—"}`}
              value={composicao.plano}
            />
            {composicao.modulos.length > 0 ? (
              composicao.modulos.map((m) => (
                <CompLine
                  key={m.modulo_id}
                  label={`+ ${m.nome}`}
                  value={Number(m.valor ?? 0)}
                  muted
                />
              ))
            ) : (
              <p className="pt-1 text-xs text-muted-foreground">
                Nenhum módulo adicional contratado.
              </p>
            )}
            <div className="mt-3 flex items-center justify-between border-t border-border pt-2 font-semibold">
              <span>Total</span>
              <span>{fmtBRL(composicao.total)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ============================================================
          MÓDULOS ATIVOS / DISPONÍVEIS
         ============================================================ */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Módulos</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Liberados pelo seu plano e disponíveis para contratação.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/modulos">Gerenciar módulos</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {loadingModsDisp ? (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-28 rounded-lg" />
              ))}
            </div>
          ) : modulosDisp.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum módulo cadastrado no catálogo.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {modulosDisp.map((mod) => {
                const meu = meusModulos.find((m) => m.modulo_id === mod.id);
                return (
                  <ModuloMiniCard
                    key={mod.id}
                    modulo={mod}
                    estado={meu}
                  />
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ============================================================
          HISTÓRICO DE PAGAMENTOS
         ============================================================ */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Histórico de pagamentos</CardTitle>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Cobranças e recebimentos vinculados à sua assinatura e módulos.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {loadingPag ? (
            <div className="space-y-2 p-6">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : pagamentos.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nenhum pagamento registrado ainda.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Referência</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Pagamento</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagamentos.map((p) => {
                    const refLabel =
                      p.referencia_tipo === "plano"
                        ? `Plano · ${p.plano?.nome ?? "—"}`
                        : p.referencia_tipo === "modulo"
                          ? `Módulo · ${p.modulo?.nome ?? "—"}`
                          : "Outro";
                    const tonePag =
                      statusPagamentoTone[p.status] ??
                      "bg-muted text-muted-foreground border-border";
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{refLabel}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {p.descricao ?? "—"}
                          {p.forma_pagamento && (
                            <span className="ml-2 text-xs uppercase tracking-wide opacity-70">
                              · {p.forma_pagamento}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {fmtDate(p.data_vencimento)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {fmtDate(p.data_pagamento)}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {fmtBRL(Number(p.valor))}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`border ${tonePag}`}
                          >
                            {statusPagamentoLabel[p.status] ?? p.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ============================================================
          PLANOS DISPONÍVEIS (resumo, redireciona para /planos)
         ============================================================ */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Outros planos disponíveis</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Veja outras opções caso precise de mais usuários ou produtos.
            </p>
          </div>
          <Button asChild size="sm">
            <Link to="/planos">Ver detalhes</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {loadingPlanos ? (
            <div className="grid gap-3 md:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-32 rounded-lg" />
              ))}
            </div>
          ) : planos.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum plano disponível.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {planos.map((p) => (
                <div
                  key={p.id}
                  className={`rounded-lg border p-4 ${
                    p.atual
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : "border-border"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className="font-semibold">{p.nome}</p>
                    {p.atual && (
                      <Badge
                        variant="outline"
                        className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                      >
                        Atual
                      </Badge>
                    )}
                  </div>
                  <p className="mt-2 text-2xl font-bold tracking-tight">
                    {fmtBRL(p.valor)}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      {tipoCobrancaLabel[p.tipo_cobranca] ?? ""}
                    </span>
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {p.limite_usuarios
                      ? `Até ${p.limite_usuarios} usuário(s)`
                      : "Usuários ilimitados"}
                    {" · "}
                    {p.limite_produtos
                      ? `${p.limite_produtos} produtos`
                      : "Produtos ilimitados"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* =========================================================
 * Helpers visuais
 * =======================================================*/
function InfoCell({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

function CompLine({
  label,
  value,
  muted,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between ${
        muted ? "text-muted-foreground" : ""
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="tabular-nums">{fmtBRL(value)}</span>
    </div>
  );
}

function ModuloMiniCard({
  modulo,
  estado,
}: {
  modulo: ModuloDisponivelCliente;
  estado?: MeuModulo;
}) {
  const solicitar = useSolicitarModulo();

  const liberado = estado?.liberado ?? false;
  const origem = estado?.origem;

  let badge: { label: string; tone: string } = {
    label: "Disponível",
    tone: "border-border text-muted-foreground",
  };
  if (origem === "ativo") {
    badge = {
      label: "Ativo",
      tone: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
    };
  } else if (origem === "trial") {
    badge = {
      label: "Trial",
      tone: "border-amber-400/40 text-amber-700 dark:text-amber-300",
    };
  } else if (origem === "sem_restricao") {
    badge = {
      label: "Incluso",
      tone: "border-primary/40 text-primary",
    };
  } else if (modulo.status === "pendente") {
    badge = {
      label: "Pendente",
      tone: "border-amber-400/40 text-amber-700 dark:text-amber-300",
    };
  } else if (modulo.status === "cancelado") {
    badge = {
      label: "Cancelado",
      tone: "border-destructive/40 text-destructive",
    };
  }

  return (
    <div className="flex h-full flex-col rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{modulo.nome}</p>
          {modulo.descricao && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {modulo.descricao}
            </p>
          )}
        </div>
        <Badge variant="outline" className={`shrink-0 border ${badge.tone}`}>
          {badge.label}
        </Badge>
      </div>

      <div className="mt-3 text-lg font-bold tabular-nums">
        {Number(modulo.valor) > 0 ? `${fmtBRL(modulo.valor)}/mês` : "Grátis"}
      </div>

      <div className="mt-auto pt-3">
        {liberado ? (
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" />
            {origem === "trial"
              ? "Liberado durante o trial"
              : origem === "sem_restricao"
                ? "Sempre liberado"
                : "Contratado"}
          </div>
        ) : modulo.status === "pendente" ? (
          <p className="text-xs text-muted-foreground">
            Aguardando confirmação do pagamento.
          </p>
        ) : (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" className="w-full">
                <Lock className="mr-1.5 h-3.5 w-3.5" />
                Contratar
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Contratar módulo: {modulo.nome}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Será criada uma solicitação de pagamento no valor de{" "}
                  <strong>{fmtBRL(modulo.valor)}/mês</strong>. Nossa equipe
                  entrará em contato para confirmar o pagamento e ativar o
                  módulo.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => solicitar.mutate(modulo.id)}
                  disabled={solicitar.isPending}
                >
                  {solicitar.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Confirmar solicitação
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  );
}
