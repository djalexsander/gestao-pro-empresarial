import { Navigate } from "@tanstack/react-router";
import { useAuth } from "./AuthProvider";
import { isErpUnlockReady, isErpUnlocked } from "@/lib/erpUnlock";

/**
 * Guarda extra para o ERP: além de exigir sessão (RequireAuth), exige
 * que o usuário tenha confirmado a senha no Hub (AdminAuthDialog).
 *
 * Se a flag de unlock não existir, manda de volta para o /hub para que
 * o usuário passe pela reautenticação administrativa.
 */
export function RequireErpUnlock({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const unlockReady = isErpUnlockReady();

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

  if (!isErpUnlocked(user.id)) {
    return <Navigate to="/hub" />;
  }

  return <>{children}</>;
}
