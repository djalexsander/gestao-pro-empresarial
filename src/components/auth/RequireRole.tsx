import { Navigate } from "@tanstack/react-router";
import { useUserRole } from "@/hooks/useUserRole";

/**
 * Bloqueia rotas do ERP completo para usuários com role exclusivo de "caixa".
 * Redireciona para /pos.
 */
export function RequireAdminLike({ children }: { children: React.ReactNode }) {
  const { isLoading, isCaixaOnly } = useUserRole();

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (isCaixaOnly) {
    return <Navigate to="/pos" />;
  }

  return <>{children}</>;
}
