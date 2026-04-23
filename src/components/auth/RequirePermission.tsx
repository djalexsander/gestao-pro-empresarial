import { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useEmpresaAtual, podeVerFinanceiro, podeGerenciarPlano } from "@/hooks/useEmpresa";

interface RequirePermissionProps {
  permission: "financeiro" | "plano";
  children: ReactNode;
}

export function RequirePermission({ permission, children }: RequirePermissionProps) {
  const { papel, isLoading } = useEmpresaAtual();

  if (isLoading) return null;

  let allowed = true;
  if (permission === "financeiro") allowed = podeVerFinanceiro(papel);
  if (permission === "plano") allowed = podeGerenciarPlano(papel);

  if (allowed) return <>{children}</>;

  return (
    <div className="mx-auto max-w-md py-12">
      <Card>
        <CardContent className="flex flex-col items-center text-center py-10 gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <Lock className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Acesso restrito</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {permission === "financeiro"
                ? "Você não tem permissão para acessar o módulo financeiro. Solicite ao proprietário."
                : "Apenas o proprietário pode gerenciar o plano da empresa."}
            </p>
          </div>
          <Button asChild variant="outline">
            <Link to="/">Voltar ao início</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
