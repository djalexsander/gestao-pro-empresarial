import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CobrancaPixDialog, type CobrancaResult } from "@/components/saas/CobrancaPixDialog";
import {
  ArrowDown,
  Check,
  Clock,
  Crown,
  Info,
  Loader2,
  Lock,
  Package,
  Puzzle,
  Sparkles,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
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
import {
  useModulosDisponiveisCliente,
  usePlanosDisponiveis,
  useSolicitarModulo,
  useSolicitarPlano,
  type ModuloDisponivelCliente,
  type PlanoDisponivel,
} from "@/hooks/useSaasCliente";
import { useMinhaAssinatura } from "@/hooks/useSaasAdmin";
import { getEffectivePlanStatus, type EffectivePlanStatus } from "@/lib/planStatus";

export const Route = createFileRoute("/modulos")({
  head: () => ({
    meta: [
      { title: "Meu Plano — Gestão Pro" },
      {
        name: "description",
        content:
          "Visualize seu plano atual, módulos ativos e contrate funcionalidades adicionais.",
      },
    ],
  }),
  component: MeuPlanoPage,
});

const fmtBRL = (n: number) =>
  Number(n ?? 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

const tipoLabel: Record<string, string> = {
  mensal: "/mês",
  anual: "/ano",
  vitalicio: " (vitalício)",
};

const statusLabel: Record<string, string> = {
  ativo: "Ativo",
  trial: "Em teste (Trial)",
  vencido: "Vencido",
  pendente: "Pendente",
  cancelado: "Cancelado",
  indefinido: "Indefinido",
};

/* =========================================================
 * Página principal
 * =======================================================*/
function MeuPlanoPage() {
  const { data: assinatura, isLoading: loadingAssin } = useMinhaAssinatura();
  const { data: planos = [], isLoading: loadingPlanos } =
    usePlanosDisponiveis();
  const { data: modulos = [], isLoading: loadingMods } =
    useModulosDisponiveisCliente();

  const effectiveStatus = getEffectivePlanStatus(assinatura);
  const isTrial = effectiveStatus === "trial";
  const isActive = effectiveStatus === "active";

  // Durante o trial, NUNCA tratamos o plano padrão como "plano atual contratado".
  // Só consideramos plano atual quando a assinatura está realmente ativa.
  const planoAtual = isActive ? (planos.find((p) => p.atual) ?? null) : null;
  const planosOutros = isActive
    ? planos.filter((p) => !p.atual)
    : planos;

  const modulosAtivos = modulos.filter(
    (m) => m.status === "ativo" || m.status === "pendente",
  );
  const modulosDisponiveis = modulos.filter(
    (m) => m.status !== "ativo" && m.status !== "pendente",
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Meu Plano"
        description={
          isTrial
            ? "Você está no período de teste gratuito. Nenhuma cobrança é gerada durante o trial."
            : "Plano Base e módulos adicionais contratados pela sua empresa."
        }
      />

      {/* === Card do plano atual / trial / bloqueado === */}
      {loadingAssin || loadingPlanos ? (
        <Skeleton className="h-[260px] rounded-xl" />
      ) : (
        <PlanoAtualCard
          plano={planoAtual}
          assinatura={assinatura}
          effectiveStatus={effectiveStatus}
        />
      )}

      {/* === Resumo visual do acesso === */}
      {!loadingAssin && !loadingMods && effectiveStatus !== "expired" && effectiveStatus !== "canceled" && (
        <ResumoAcessoCard
          isTrial={isTrial}
          temPlano={!!planoAtual}
          qtdModulos={modulosAtivos.filter((m) => m.status === "ativo").length}
        />
      )}

      {/* === Módulos ativos === */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              <Puzzle className="h-5 w-5 text-primary" />
              Módulos adicionais ativos
            </h2>
            <p className="text-sm text-muted-foreground">
              Funcionalidades extras contratadas além do Plano Base.
            </p>
          </div>
          {!loadingMods && (
            <Badge variant="secondary" className="text-xs">
              {modulosAtivos.length} ativo(s)
            </Badge>
          )}
        </div>

        {loadingMods ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[220px] rounded-xl" />
            ))}
          </div>
        ) : modulosAtivos.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
              <Package className="h-8 w-8 text-muted-foreground/60" />
              <div>
                <p className="text-sm font-medium">
                  Nenhum módulo adicional ativo
                </p>
                <p className="text-xs text-muted-foreground">
                  Você está usando apenas as funcionalidades essenciais do Plano
                  Base. Contrate módulos abaixo para expandir seu sistema.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  document
                    .getElementById("modulos-disponiveis")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                <ArrowDown className="mr-2 h-4 w-4" />
                Ver módulos disponíveis
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {modulosAtivos.map((m) => (
                <ModuloCard key={m.id} modulo={m} isTrial={isTrial} />
              ))}
            </div>
            <div className="flex justify-end pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  document
                    .getElementById("modulos-disponiveis")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Adicionar mais módulos
              </Button>
            </div>
          </>
        )}
      </section>

      <Separator />

      {/* === Módulos disponíveis para contratação === */}
      <section id="modulos-disponiveis" className="space-y-3 scroll-mt-20">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Sparkles className="h-5 w-5 text-primary" />
            Módulos disponíveis para contratação
          </h2>
          <p className="text-sm text-muted-foreground">
            Expanda seu sistema com funcionalidades extras. Cada módulo é
            cobrado separadamente do Plano Base.
          </p>
        </div>

        {loadingMods ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[220px] rounded-xl" />
            ))}
          </div>
        ) : modulosDisponiveis.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Você já contratou todos os módulos disponíveis. 🎉
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {modulosDisponiveis.map((m) => (
              <ModuloCard key={m.id} modulo={m} isTrial={isTrial} />
            ))}
          </div>
        )}
      </section>

      {/* === Trocar de plano (inline, sem redirecionar) === */}
      {!loadingPlanos && planosOutros.length > 0 && (
        <>
          <Separator />
          <section className="space-y-3">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                Outros planos disponíveis
              </h2>
              <p className="text-sm text-muted-foreground">
                Faça upgrade ou troca de plano a qualquer momento.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {planosOutros.map((p, idx) => (
                <PlanoCard
                  key={p.id}
                  plano={p}
                  destaque={idx === 0 && planosOutros.length >= 2}
                />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/* =========================================================
 * Card do plano atual (topo da tela)
 * =======================================================*/
function PlanoAtualCard({
  plano,
  assinatura,
  effectiveStatus,
}: {
  plano: PlanoDisponivel | null;
  assinatura: ReturnType<typeof useMinhaAssinatura>["data"];
  effectiveStatus: EffectivePlanStatus;
}) {
  // ===== TRIAL =====
  if (effectiveStatus === "trial") {
    const dias = assinatura?.dias_restantes ?? 0;
    const expira = assinatura?.data_expiracao
      ? new Date(assinatura.data_expiracao).toLocaleDateString("pt-BR")
      : null;
    return (
      <Card className="overflow-hidden border-blue-500/30 bg-gradient-to-br from-blue-500/10 via-background to-background">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Status atual
              </p>
              <CardTitle className="flex items-center gap-2 text-2xl">
                <Sparkles className="h-5 w-5 text-blue-500" />
                Teste gratuito ativo
              </CardTitle>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Você está experimentando todos os módulos por <strong>7 dias</strong>,
                sem custo. Nenhuma cobrança é gerada durante o trial.
              </p>
            </div>
            <Badge className="gap-1 bg-blue-500 hover:bg-blue-600">
              <Clock className="h-3 w-3" />
              {dias > 0 ? `${dias} dia(s) restante(s)` : "Último dia"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">Início do teste</p>
              <p className="text-sm font-medium">
                {assinatura?.data_inicio
                  ? new Date(assinatura.data_inicio).toLocaleDateString("pt-BR")
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Expira em</p>
              <p className="text-sm font-medium">{expira ?? "—"}</p>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-md border border-blue-500/20 bg-blue-500/5 p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
            <span>
              Durante o trial, todos os módulos aparecem como{" "}
              <strong className="text-foreground">Ativo (temporário)</strong>.
              Ao final do período, contrate um Plano Base e selecione os módulos
              desejados para manter o acesso.
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ===== EXPIRED / CANCELED =====
  if (effectiveStatus === "expired" || effectiveStatus === "canceled") {
    return (
      <Card className="overflow-hidden border-destructive/40 bg-destructive/5">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Acesso bloqueado
              </p>
              <CardTitle className="flex items-center gap-2 text-2xl text-destructive">
                <Lock className="h-5 w-5" />
                {effectiveStatus === "expired"
                  ? "Período de teste encerrado"
                  : "Assinatura cancelada"}
              </CardTitle>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Para voltar a usar o sistema, contrate um Plano Base abaixo.
                Seus dados estão preservados e serão liberados imediatamente
                após a confirmação do pagamento.
              </p>
            </div>
            <Badge variant="destructive" className="gap-1">
              <Lock className="h-3 w-3" />
              {effectiveStatus === "expired" ? "Expirado" : "Cancelado"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <Button
            className="w-full sm:w-auto"
            onClick={() => {
              document
                .getElementById("modulos-disponiveis")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            <Crown className="mr-2 h-4 w-4" />
            Ver planos disponíveis
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ===== ACTIVE / PENDING / NONE =====
  const status = assinatura?.status ?? "indefinido";
  const statusVariant =
    status === "ativo"
      ? "bg-emerald-500 hover:bg-emerald-600"
      : "bg-amber-500 hover:bg-amber-600";

  return (
    <Card className="overflow-hidden border-primary/30 bg-gradient-to-br from-primary/5 via-background to-background">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Plano atual
            </p>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Crown className="h-5 w-5 text-primary" />
              {plano?.nome ?? "Sem plano contratado"}
            </CardTitle>
            {plano?.descricao && (
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                {plano.descricao}
              </p>
            )}
          </div>
          <Badge className={`gap-1 capitalize ${statusVariant}`}>
            {statusLabel[status] ?? status}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Valor</p>
            <p className="text-xl font-bold tracking-tight">
              {plano ? fmtBRL(plano.valor) : "—"}
              {plano && (
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  {tipoLabel[plano.tipo_cobranca] ?? ""}
                </span>
              )}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Início</p>
            <p className="text-sm font-medium">
              {assinatura?.data_inicio
                ? new Date(assinatura.data_inicio).toLocaleDateString("pt-BR")
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Próximo vencimento</p>
            <p className="text-sm font-medium">
              {assinatura?.data_expiracao
                ? new Date(assinatura.data_expiracao).toLocaleDateString("pt-BR")
                : "Sem vencimento"}
            </p>
          </div>
        </div>

        {plano && (
          <>
            <Separator />
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                O que está incluído no Plano Base
              </p>
              <ul className="grid gap-2 text-sm sm:grid-cols-2">
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  <span>Acesso às funcionalidades essenciais do sistema</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  <span>
                    {plano.limite_usuarios
                      ? `Até ${plano.limite_usuarios} usuário(s)`
                      : "Usuários ilimitados"}
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  <span>
                    {plano.limite_produtos
                      ? `Até ${plano.limite_produtos} produtos`
                      : "Produtos ilimitados"}
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  <span>Suporte por e-mail</span>
                </li>
              </ul>
              <div className="mt-3 flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>
                  <strong className="text-foreground">Módulos adicionais</strong>{" "}
                  (como Financeiro, Relatórios avançados e outros) são
                  contratados separadamente do Plano Base.
                </span>
              </div>
            </div>
          </>
        )}

        {assinatura?.readonly && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            Sua assinatura está em modo somente leitura. Regularize o pagamento
            para liberar o sistema novamente.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* =========================================================
 * Resumo visual do acesso (Plano Base + módulos)
 * =======================================================*/
function ResumoAcessoCard({
  isTrial,
  temPlano,
  qtdModulos,
}: {
  isTrial: boolean;
  temPlano: boolean;
  qtdModulos: number;
}) {
  return (
    <Card className="border-primary/20 bg-muted/30">
      <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
        <div className="flex items-center gap-4">
          <div className="rounded-full bg-primary/10 p-2">
            <Check className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Seu acesso atual inclui
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              {isTrial ? (
                <Badge className="gap-1 bg-blue-500 hover:bg-blue-600">
                  <Sparkles className="h-3 w-3" />
                  Trial — todos os módulos liberados temporariamente
                </Badge>
              ) : (
                <>
                  <Badge
                    variant={temPlano ? "default" : "outline"}
                    className="gap-1"
                  >
                    {temPlano ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Lock className="h-3 w-3" />
                    )}
                    Plano Base
                  </Badge>
                  <span className="text-muted-foreground">+</span>
                  <Badge
                    variant={qtdModulos > 0 ? "default" : "secondary"}
                    className="gap-1"
                  >
                    <Puzzle className="h-3 w-3" />
                    {qtdModulos === 0
                      ? "Nenhum módulo adicional"
                      : `${qtdModulos} módulo(s) ativo(s)`}
                  </Badge>
                </>
              )}
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            document
              .getElementById("modulos-disponiveis")
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        >
          <Sparkles className="mr-2 h-4 w-4" />
          Gerenciar módulos
        </Button>
      </CardContent>
    </Card>
  );
}

/* =========================================================
 * Card de módulo (reutilizado nas duas seções)
 * =======================================================*/
function StatusBadgeMod({
  status,
  isTrial,
}: {
  status: string;
  isTrial: boolean;
}) {
  // Durante o trial, todos os módulos são liberados temporariamente.
  if (isTrial && status !== "cancelado") {
    return (
      <Badge className="gap-1 bg-blue-500 hover:bg-blue-600">
        <Sparkles className="h-3 w-3" /> Ativo (temporário)
      </Badge>
    );
  }
  if (status === "ativo")
    return (
      <Badge className="gap-1 bg-emerald-500 hover:bg-emerald-600">
        <Check className="h-3 w-3" /> Ativo
      </Badge>
    );
  if (status === "pendente")
    return (
      <Badge variant="outline" className="gap-1 border-amber-500 text-amber-600">
        <Clock className="h-3 w-3" /> Pendente
      </Badge>
    );
  if (status === "cancelado")
    return <Badge variant="destructive">Cancelado</Badge>;
  return (
    <Badge variant="secondary" className="gap-1">
      <Lock className="h-3 w-3" /> Não contratado
    </Badge>
  );
}

function ModuloCard({
  modulo,
  isTrial,
}: {
  modulo: ModuloDisponivelCliente;
  isTrial: boolean;
}) {
  const solicitar = useSolicitarModulo();
  const [cobranca, setCobranca] = useState<CobrancaResult | null>(null);
  const isContratado =
    modulo.status === "ativo" || modulo.status === "pendente";

  return (
    <Card
      className={
        isTrial
          ? "border-blue-500/30"
          : modulo.status === "ativo"
            ? "border-emerald-500/30"
            : ""
      }
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Puzzle className="h-4 w-4 text-primary" />
            {modulo.nome}
          </CardTitle>
          <StatusBadgeMod status={modulo.status} isTrial={isTrial} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {modulo.descricao && (
          <p className="text-sm text-muted-foreground">{modulo.descricao}</p>
        )}

        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold tracking-tight">
            {fmtBRL(modulo.valor)}
          </span>
          <span className="text-xs text-muted-foreground">/mês</span>
        </div>

        {isTrial && !isContratado && (
          <p className="text-xs text-blue-600 dark:text-blue-400">
            Liberado durante o teste gratuito. Contrate para manter o acesso ao
            final do trial.
          </p>
        )}

        {modulo.data_expiracao && modulo.status === "ativo" && !isTrial && (
          <p className="text-xs text-muted-foreground">
            Válido até{" "}
            {new Date(modulo.data_expiracao).toLocaleDateString("pt-BR")}
          </p>
        )}

        {modulo.status === "ativo" && (
          <Button disabled className="w-full" variant="outline">
            Já contratado
          </Button>
        )}

        {modulo.status === "pendente" && (
          <Button disabled className="w-full" variant="outline">
            Aguardando confirmação
          </Button>
        )}

        {!isContratado && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button className="w-full">
                {isTrial ? "Selecionar para contratar" : "Contratar módulo"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Solicitar contratação: {modulo.nome}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {isTrial
                    ? "Você está em período de teste — nenhuma cobrança é gerada agora. A solicitação ficará registrada e o módulo continuará ativo após a contratação do Plano Base."
                    : null}
                  {" "}Será criada uma solicitação de pagamento no valor de{" "}
                  <strong>{fmtBRL(modulo.valor)}</strong>. Nossa equipe entrará
                  em contato para confirmar o pagamento e ativar o módulo.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={async () => {
                    const r = await solicitar.mutateAsync(modulo.id);
                    if (r.cobranca) setCobranca(r.cobranca);
                  }}
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
      </CardContent>
      <CobrancaPixDialog
        open={!!cobranca}
        onOpenChange={(v) => !v && setCobranca(null)}
        cobranca={cobranca}
      />
    </Card>
  );
}

/* =========================================================
 * Card de plano alternativo (inline, sem navegação)
 * =======================================================*/
function PlanoCard({
  plano,
  destaque,
}: {
  plano: PlanoDisponivel;
  destaque: boolean;
}) {
  const solicitar = useSolicitarPlano();
  const [cobranca, setCobranca] = useState<CobrancaResult | null>(null);

  return (
    <Card
      className={
        destaque ? "relative border-primary shadow-lg shadow-primary/10" : ""
      }
    >
      {destaque && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge className="gap-1 bg-primary px-3 py-1">
            <Sparkles className="h-3 w-3" />
            Recomendado
          </Badge>
        </div>
      )}
      <CardHeader className="pb-2">
        <CardTitle className="text-xl">{plano.nome}</CardTitle>
        {plano.descricao && (
          <p className="text-sm text-muted-foreground">{plano.descricao}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <span className="text-3xl font-bold tracking-tight">
            {fmtBRL(plano.valor)}
          </span>
          <span className="text-sm text-muted-foreground">
            {tipoLabel[plano.tipo_cobranca] ?? ""}
          </span>
        </div>

        <ul className="space-y-2 text-sm">
          <li className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            <span>
              {plano.limite_usuarios
                ? `Até ${plano.limite_usuarios} usuário(s)`
                : "Usuários ilimitados"}
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            <span>
              {plano.limite_produtos
                ? `Até ${plano.limite_produtos} produtos`
                : "Produtos ilimitados"}
            </span>
          </li>
        </ul>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              className="w-full"
              variant={destaque ? "default" : "outline"}
            >
              Trocar para este plano
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Solicitar troca para: {plano.nome}
              </AlertDialogTitle>
              <AlertDialogDescription>
                Será criada uma solicitação de pagamento no valor de{" "}
                <strong>{fmtBRL(plano.valor)}</strong>. Nossa equipe entrará em
                contato para confirmar o pagamento e ativar o plano.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  const r = await solicitar.mutateAsync(plano.id);
                  if (r.cobranca) setCobranca(r.cobranca);
                }}
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
      </CardContent>
      <CobrancaPixDialog
        open={!!cobranca}
        onOpenChange={(v) => !v && setCobranca(null)}
        cobranca={cobranca}
      />
    </Card>
  );
}
