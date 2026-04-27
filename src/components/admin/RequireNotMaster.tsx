import { Navigate } from "@tanstack/react-router";
import { useMasterContext } from "./MasterContextProvider";

/**
 * Bloqueia rotas operacionais (ERP/PDV/etc.) enquanto o super_admin está com o
 * modo master ativo. Para acessar telas de empresa, é preciso explicitamente
 * sair do modo master pela sidebar do painel administrativo.
 */
export function RequireNotMaster({ children }: { children: React.ReactNode }) {
  const { isMasterMode } = useMasterContext();

  if (isMasterMode) {
    return <Navigate to="/admin" replace />;
  }

  return <>{children}</>;
}
