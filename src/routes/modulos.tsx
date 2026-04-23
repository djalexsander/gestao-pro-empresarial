import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Clock, Loader2, Lock, Puzzle } from "lucide-react";
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
  useModulosDisponiveisCliente,
  useSolicitarModulo,
  type ModuloDisponivelCliente,
} from "@/hooks/useSaasCliente";

export const Route = createFileRoute("/modulos")({
  head: () => ({
    meta: [
      { title: "Módulos — Gestão Pro" },
      {
        name: "description",
        content: "Contrate módulos adicionais para potencializar seu plano.",
      },
    ],
  }),
  component: ModulosClientePage,
});

const fmtBRL = (n: number) =>
  Number(n ?? 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

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

function ModulosClientePage() {
  const { data: modulos = [], isLoading } = useModulosDisponiveisCliente();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Módulos adicionais"
        description="Contrate funcionalidades extras conforme sua necessidade."
        actions={
          <Button asChild variant="outline">
            <Link to="/planos">Ver planos</Link>
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[260px] rounded-xl" />
          ))}
        </div>
      ) : modulos.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhum módulo disponível no momento.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {modulos.map((m) => (
            <ModuloCard key={m.id} modulo={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function ModuloCard({ modulo }: { modulo: ModuloDisponivelCliente }) {
  const solicitar = useSolicitarModulo();
  const isContratado = modulo.status === "ativo" || modulo.status === "pendente";

  return (
    <Card>
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
