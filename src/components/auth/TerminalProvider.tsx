import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";

const STORAGE_KEY = "gp.terminal";

export interface TerminalSelecionado {
  id: string;
  nome: string;
}

interface TerminalContextValue {
  terminal: TerminalSelecionado | null;
  setTerminal: (t: TerminalSelecionado | null) => void;
  limparTerminal: () => void;
}

const TerminalContext = createContext<TerminalContextValue | null>(null);

function loadFromStorage(): TerminalSelecionado | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as TerminalSelecionado;
  } catch {
    return null;
  }
}

/**
 * Persiste o terminal selecionado deste dispositivo em localStorage
 * (sobrevive a logout para futuro uso com Tauri = "este dispositivo é o caixa X").
 */
export function TerminalProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [terminal, setTerminalState] = useState<TerminalSelecionado | null>(() =>
    loadFromStorage(),
  );

  // Re-hidrata quando o usuário faz login (caso outra aba tenha mudado)
  useEffect(() => {
    if (user) {
      const t = loadFromStorage();
      if (t && (!terminal || terminal.id !== t.id)) setTerminalState(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const setTerminal = useCallback((t: TerminalSelecionado | null) => {
    setTerminalState(t);
    try {
      if (t) localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const limparTerminal = useCallback(() => setTerminal(null), [setTerminal]);

  return (
    <TerminalContext.Provider value={{ terminal, setTerminal, limparTerminal }}>
      {children}
    </TerminalContext.Provider>
  );
}

export function useTerminal() {
  const ctx = useContext(TerminalContext);
  if (!ctx) throw new Error("useTerminal deve ser usado dentro de <TerminalProvider>");
  return ctx;
}
