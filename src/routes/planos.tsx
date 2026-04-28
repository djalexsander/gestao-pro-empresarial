import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Sparkles, Crown, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  usePlanosDisponiveis,
  useSolicitarPlano,
  type PlanoDisponivel,
} from "@/hooks/useSaasCliente";
import { useMinhaAssinatura } from "@/hooks/useSaasAdmin";

export const Route = createFileRoute("/planos")({
  head: () => ({
    meta: [
      { title: "Planos — Gestão Pro" },
      {
        name: "description",
        content: "Conheça e contrate o plano ideal para sua empresa.",
      },
    ],
  }),
  component: PlanosClientePage,
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

function PlanosClientePage() {
  const { data: assinatura } = useMinhaAssinatura();
  const { data: planos = [], isLoading } = usePlanosDisponiveis();
  const isTrial = assinatura?.status === "trial" && !assinatura?.readonly;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Planos disponíveis"
        description="Escolha o plano que melhor atende sua empresa. Após a solicitação, nossa equipe entrará em contato para confirmar o pagamento e ativar."
      />

      {assinatura && !assinatura.sem_empresa && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div>
              <p className="text-sm text-muted-foreground">
                Status atual da sua assinatura
              </p>
              <p className="text-lg font-semibold capitalize">
                {assinatura.status}
                {assinatura.status === "trial" && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    ({assinatura.dias_restantes} dia(s) restante(s))
                  </span>
                )}
              </p>
            </div>
            {assinatura.readonly && (
              <Badge variant="destructive">Sistema em modo leitura</Badge>
            )}
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[420px] rounded-xl" />
          ))}
        </div>
      ) : planos.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhum plano disponível no momento.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {planos.map((p, idx) => (
            <PlanoCard
              key={p.id}
              plano={p}
              destaque={idx === 1 && planos.length >= 3}
              isTrial={isTrial}
            />
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Quer mais funcionalidades?</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Veja os módulos adicionais disponíveis para potencializar seu plano.
          </p>
          <Button asChild variant="outline">
            <Link to="/modulos">Ver módulos</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

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
        destaque
          ? "relative border-primary shadow-lg shadow-primary/10"
          : plano.atual
            ? "border-emerald-500/40"
            : ""
      }
    >
      {destaque && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge className="gap-1 bg-primary px-3 py-1">
            <Sparkles className="h-3 w-3" />
            Mais popular
          </Badge>
        </div>
      )}
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-xl">
            {plano.nome}
            {plano.atual && (
              <Crown className="h-4 w-4 text-emerald-500" />
            )}
          </CardTitle>
        </div>
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

        {plano.atual ? (
          <Button disabled className="w-full" variant="outline">
            Plano atual
          </Button>
        ) : (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                className="w-full"
                variant={destaque ? "default" : "outline"}
              >
                Contratar plano
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Solicitar contratação: {plano.nome}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Será criada uma solicitação de pagamento no valor de{" "}
                  <strong>{fmtBRL(plano.valor)}</strong>. Nossa equipe entrará
                  em contato para confirmar o pagamento e ativar o plano.
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
        )}
      </CardContent>
    </Card>
  );
}
