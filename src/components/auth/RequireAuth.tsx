import { Navigate, useLocation } from "@tanstack/react-router";
import { useAuth } from "./AuthProvider";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  // Sincroniza vendas/estoque/caixas/financeiro entre todos os terminais
  // conectados à mesma base (modelo "rede de PDV").
  useRealtimeSync(!!user);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" search={{ redirect: location.pathname }} />;
  }

  return <>{children}</>;
}
