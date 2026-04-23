import { ReactNode } from "react";
import { Lock, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useModulo } from "@/hooks/useSaasAdmin";

interface ModuloGateProps {
  /** Chave técnica do módulo (ex: "financeiro_avancado") */
  chave: string;
  /** Conteúdo liberado quando o módulo está ativo. */
  children: ReactNode;
  /** Título amigável para a tela de bloqueio. */
  titulo?: string;
}

/**
 * Envolve uma área do ERP que depende de um módulo pago.
 * - Liberado → renderiza children.
 * - Trial → renderiza children + badge "Ativo (trial)".
 * - Bloqueado → renderiza CTA "Ativar módulo".
 */
export function ModuloGate({ chave, children, titulo }: ModuloGateProps) {
  const { isLoading, modulo, liberado, origem } = useModulo(chave);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (liberado) {
    return (
      <>
        {origem === "trial" && (
          <div className="mb-4 flex items-center gap-2">
            <Badge variant="outline" className="gap-1 border-amber-400/40 bg-amber-400/10 text-amber-700 dark:text-amber-300">
              <Sparkles className="h-3 w-3" /> Ativo (trial)
            </Badge>
            <span className="text-xs text-muted-foreground">
              Liberado durante o período de teste.
            </span>
          </div>
        )}
        {children}
      </>
    );
  }

  // Bloqueado
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="max-w-md text-center">
        <CardContent className="space-y-4 p-8">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <Lock className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-xl font-semibold">
              {titulo ?? modulo?.nome ?? "Recurso bloqueado"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Este recurso faz parte de um módulo pago.
              {modulo?.descricao ? ` ${modulo.descricao}` : ""}
            </p>
          </div>
          <Button
            className="w-full"
            onClick={() =>
              window.open(
                "mailto:contato@alexproapps.com.br?subject=" +
                  encodeURIComponent(`Ativar módulo ${modulo?.nome ?? chave}`),
                "_blank",
              )
            }
          >
            Ativar módulo
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
