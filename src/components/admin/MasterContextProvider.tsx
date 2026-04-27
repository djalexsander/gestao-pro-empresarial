import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "@tanstack/react-router";
import { useIsSuperAdmin } from "@/hooks/useAdmin";

interface MasterContextValue {
  /** True quando o super_admin está deliberadamente operando no painel master. */
  isMasterMode: boolean;
  /** True quando o usuário tem permissão para entrar no modo master. */
  isSuperAdmin: boolean;
  /** Ativa o modo master (chamar antes de navegar para /admin). */
  enterMasterMode: () => void;
  /** Desliga o modo master (libera acesso a rotas de empresa). */
  exitMasterMode: () => void;
}

const MasterContext = createContext<MasterContextValue | null>(null);
const STORAGE_KEY = "app:master-mode-active";

function readPersisted(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "1";
}

export function MasterContextProvider({ children }: { children: ReactNode }) {
  const { data: isSuperAdmin = false } = useIsSuperAdmin();
  const location = useLocation();
  const [isMasterMode, setIsMasterMode] = useState<boolean>(() => readPersisted());

  // Se o usuário perdeu o status de super_admin, força saída do modo master.
  useEffect(() => {
    if (!isSuperAdmin && isMasterMode) {
      setIsMasterMode(false);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, [isSuperAdmin, isMasterMode]);

  // Ao entrar em qualquer rota /admin/*, ativa automaticamente o modo master
  // (cobre o caso de o usuário acessar via deep link).
  useEffect(() => {
    const inAdmin = location.pathname === "/admin" || location.pathname.startsWith("/admin/");
    if (inAdmin && isSuperAdmin && !isMasterMode) {
      setIsMasterMode(true);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, "1");
      }
    }
  }, [location.pathname, isSuperAdmin, isMasterMode]);

  const enterMasterMode = useCallback(() => {
    setIsMasterMode(true);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, "1");
    }
  }, []);

  const exitMasterMode = useCallback(() => {
    setIsMasterMode(false);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const value = useMemo<MasterContextValue>(
    () => ({ isMasterMode, isSuperAdmin, enterMasterMode, exitMasterMode }),
    [isMasterMode, isSuperAdmin, enterMasterMode, exitMasterMode],
  );

  return <MasterContext.Provider value={value}>{children}</MasterContext.Provider>;
}

export function useMasterContext() {
  const ctx = useContext(MasterContext);
  if (!ctx) throw new Error("useMasterContext deve ser usado dentro de <MasterContextProvider>");
  return ctx;
}
