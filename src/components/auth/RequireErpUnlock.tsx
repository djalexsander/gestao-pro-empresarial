import { useEffect } from "react";
import { Navigate } from "@tanstack/react-router";
import { useAuth } from "./AuthProvider";
import { isErpUnlockReady, isErpUnlocked } from "@/lib/erpUnlock";
import { isDesktopTerminal } from "@/components/desktop/DesktopRoleProvider";

/**
 * Guarda extra para o ERP: além de exigir sessão (RequireAuth), exige
 * que o usuário tenha confirmado a senha no Hub (AdminAuthDialog).
 *
 * Máquinas configuradas como "terminal" PODEM acessar o ERP desde que
 * passem por este unlock (admin/gerente). O papel da máquina não bloqueia
 * o acesso — apenas define o modo padrão de operação.
 */
export function RequireErpUnlock({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const unlockReady = isErpUnlockReady();
  const unlocked = !!user && isErpUnlocked(user.id);

  useEffect(() => {
    if (unlocked && isDesktopTerminal()) {
      console.log("[MODE_ACCESS] terminal permitindo acesso ERP com admin");
    }
  }, [unlocked]);

  if (loading || !unlockReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" search={{ redirect: "/hub" }} />;
  }

  if (!unlocked) {
    return <Navigate to="/hub" />;
  }

  return <>{children}</>;
}
