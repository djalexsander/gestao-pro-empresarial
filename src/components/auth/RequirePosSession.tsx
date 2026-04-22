import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useOperador } from "@/components/auth/OperadorProvider";
import { useTerminal } from "@/components/auth/TerminalProvider";
import { useCaixaAberto } from "@/hooks/useCaixa";

/**
 * Guard para a rota /pdv.
 *
 * Garante que existe:
 *  1. Usuário autenticado (admin/dono)
 *  2. Terminal selecionado
 *  3. Operador logado (com PIN)
 *  4. Caixa aberto para este operador
 *
 * Caso contrário, redireciona para /pos para completar o fluxo.
 */
export function RequirePosSession({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { user, loading: loadingAuth } = useAuth();
  const { operador } = useOperador();
  const { terminal } = useTerminal();
  const { data: caixaAberto, isLoading: loadingCaixa } = useCaixaAberto(
    operador?.id ?? null,
  );

  const precondicoesOk = !!user && !!terminal && !!operador;

  useEffect(() => {
    if (loadingAuth) return;
    if (!user) {
      navigate({ to: "/auth", search: { redirect: "/pos" } });
      return;
    }
    if (!terminal || !operador) {
      navigate({ to: "/pos" });
      return;
    }
  }, [loadingAuth, user, terminal, operador, navigate]);

  useEffect(() => {
    if (!precondicoesOk) return;
    if (loadingCaixa) return;
    if (!caixaAberto) {
      navigate({ to: "/pos" });
    }
  }, [precondicoesOk, loadingCaixa, caixaAberto, navigate]);

  if (loadingAuth || !precondicoesOk || loadingCaixa || !caixaAberto) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">Verificando sessão do caixa…</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
