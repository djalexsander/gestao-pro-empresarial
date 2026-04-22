import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { OperadorSessao } from "@/hooks/useFuncionarios";
import { useAuth } from "./AuthProvider";

const STORAGE_KEY = "gp.operador";

interface OperadorContextValue {
  operador: OperadorSessao | null;
  setOperador: (op: OperadorSessao | null) => void;
  trocarOperador: () => void;
  /** true quando o admin/gerente está logado e nenhum operador foi selecionado.
   * Útil para mostrar a tela hub. */
  precisaSelecionarOperador: boolean;
}

const OperadorContext = createContext<OperadorContextValue | null>(null);

function loadFromStorage(): OperadorSessao | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as OperadorSessao;
  } catch {
    return null;
  }
}

export function OperadorProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [operador, setOperadorState] = useState<OperadorSessao | null>(() => loadFromStorage());

  // Limpa operador ao deslogar
  useEffect(() => {
    if (!user) {
      setOperadorState(null);
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
  }, [user]);

  const setOperador = useCallback((op: OperadorSessao | null) => {
    setOperadorState(op);
    try {
      if (op) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(op));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const trocarOperador = useCallback(() => setOperador(null), [setOperador]);

  return (
    <OperadorContext.Provider
      value={{
        operador,
        setOperador,
        trocarOperador,
        precisaSelecionarOperador: !!user && !operador,
      }}
    >
      {children}
    </OperadorContext.Provider>
  );
}

export function useOperador() {
  const ctx = useContext(OperadorContext);
  if (!ctx) throw new Error("useOperador deve ser usado dentro de <OperadorProvider>");
  return ctx;
}
