import { createFileRoute } from "@tanstack/react-router";
import {
  Check,
  Clock,
  Crown,
  Loader2,
  Lock,
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
  expirado: "Expirado",
  pendente: "Pendente",
  cancelado: "Cancelado",
  bloqueada: "Bloqueada",
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

  const planoAtual = planos.find((p) => p.atual) ?? null;
  const planosOutros = planos.filter((p) => !p.atual);

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
        description="Visão completa do seu plano atual, módulos ativos e funcionalidades adicionais disponíveis."
      />

      {/* === Card do plano atual === */}
      {loadingAssin || loadingPlanos ? (
        <Skeleton className="h-[220px] rounded-xl" />
      ) : (
        <PlanoAtualCard plano={planoAtual} assinatura={assinatura} />
      )}

      {/* === Módulos ativos === */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              Módulos ativos
            </h2>
            <p className="text-sm text-muted-foreground">
              Funcionalidades já liberadas para sua empresa.
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
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Nenhum módulo ativo no momento.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {modulosAtivos.map((m) => (
              <ModuloCard key={m.id} modulo={m} />
            ))}
          </div>
        )}
      </section>

      <Separator />

      {/* === Módulos disponíveis para contratação === */}
      <section className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            Módulos disponíveis para contratação
          </h2>
          <p className="text-sm text-muted-foreground">
            Adicione funcionalidades extras conforme sua necessidade.
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
              <ModuloCard key={m.id} modulo={m} />
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
}: {
  plano: PlanoDisponivel | null;
  assinatura: ReturnType<typeof useMinhaAssinatura>["data"];
}) {
  const status = assinatura?.status ?? "indefinido";
  const statusVariant =
    status === "ativo"
      ? "bg-emerald-500 hover:bg-emerald-600"
      : status === "trial"
        ? "bg-blue-500 hover:bg-blue-600"
        : status === "expirado" || status === "bloqueada"
          ? "bg-destructive hover:bg-destructive/90"
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
            {status === "trial" &&
              typeof assinatura?.dias_restantes === "number" && (
                <span className="ml-1 text-xs opacity-90">
                  · {assinatura.dias_restantes} dia(s)
                </span>
              )}
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
            <p className="text-xs text-muted-foreground">Vencimento</p>
            <p className="text-sm font-medium">
              {assinatura?.data_expiracao
                ? new Date(assinatura.data_expiracao).toLocaleDateString(
                    "pt-BR",
                  )
                : "Sem vencimento"}
            </p>
          </div>
        </div>

        {plano && (
          <>
            <Separator />
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Benefícios incluídos
              </p>
              <ul className="grid gap-2 text-sm sm:grid-cols-2">
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  <span>Acesso completo ao ERP</span>
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
            </div>
          </>
        )}

        {assinatura?.readonly && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            Sua assinatura está em modo somente leitura. Regularize o pagamento
            para liberar o ERP completo.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* =========================================================
 * Card de módulo (reutilizado nas duas seções)
 * =======================================================*/
function StatusBadgeMod({ status }: { status: string }) {
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

function ModuloCard({ modulo }: { modulo: ModuloDisponivelCliente }) {
  const solicitar = useSolicitarModulo();
  const isContratado =
    modulo.status === "ativo" || modulo.status === "pendente";

  return (
    <Card className={modulo.status === "ativo" ? "border-emerald-500/30" : ""}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Puzzle className="h-4 w-4 text-primary" />
            {modulo.nome}
          </CardTitle>
          <StatusBadgeMod status={modulo.status} />
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

        {modulo.data_expiracao && modulo.status === "ativo" && (
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
              <Button className="w-full">Contratar módulo</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Solicitar contratação: {modulo.nome}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Será criada uma solicitação de pagamento no valor de{" "}
                  <strong>{fmtBRL(modulo.valor)}</strong>. Nossa equipe entrará
                  em contato para confirmar o pagamento e ativar o módulo.
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
      </CardContent>
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
                onClick={() => solicitar.mutate(plano.id)}
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
    </Card>
  );
}
