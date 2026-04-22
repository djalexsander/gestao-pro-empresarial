import { ReactNode } from "react";
import { Navigate, Outlet } from "@tanstack/react-router";
import { Shield } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useIsSuperAdmin } from "@/hooks/useAdmin";

interface Props {
  children?: ReactNode;
}

export function RequireSuperAdmin({ children }: Props) {
  const { user, loading } = useAuth();
  const { data: isSuper, isLoading } = useIsSuperAdmin();

  if (loading || isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
        Verificando permissões...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" search={{ redirect: "/admin" }} />;
  }

  if (!isSuper) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center text-center">
        <Shield className="mb-4 h-12 w-12 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Acesso restrito</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Esta área é exclusiva para o administrador do sistema.
        </p>
      </div>
    );
  }

  return <>{children ?? <Outlet />}</>;
}
