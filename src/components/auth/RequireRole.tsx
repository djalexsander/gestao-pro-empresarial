import { Navigate, useLocation } from "@tanstack/react-router";
import { isCaixaAllowedPath, useUserRole } from "@/hooks/useUserRole";

/**
 * Bloqueia rotas administrativas do ERP para usuários com role exclusivo de "caixa".
 *
 * - Caixa pode acessar: /pos, /pdv, /produtos, /estoque, /compras (e suas sub-rotas)
 * - Em qualquer outra rota do ERP, redireciona para /pos.
 *
 * Admin/gerente/super_admin (ou usuários sem roles atribuídos) seguem com acesso total.
 */
export function RequireAdminLike({ children }: { children: React.ReactNode }) {
  const { isLoading, isCaixaOnly } = useUserRole();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (isCaixaOnly && !isCaixaAllowedPath(location.pathname)) {
    return <Navigate to="/pos" />;
  }

  return <>{children}</>;
}
