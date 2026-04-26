import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { toast } from "sonner";
import { useAuth } from "./AuthProvider";
import { useTerminaisAtivos } from "@/hooks/useTerminais";

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
 *
 * Também valida automaticamente o terminal armazenado contra a lista atual
 * de terminais ativos da empresa — se o terminal foi excluído, desativado
 * ou pertence a outra empresa, limpa o cache para forçar nova seleção.
 */
export function TerminalProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [terminal, setTerminalState] = useState<TerminalSelecionado | null>(
    () => loadFromStorage(),
  );

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

  // Re-hidrata quando o usuário faz login (caso outra aba tenha mudado)
  useEffect(() => {
    if (user) {
      const t = loadFromStorage();
      if (t && (!terminal || terminal.id !== t.id)) setTerminalState(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Valida o terminal armazenado contra a lista real do servidor.
  // Só roda se há usuário logado E há terminal cacheado.
  const { data: terminaisAtivos = [], isSuccess } = useTerminaisAtivos();

  useEffect(() => {
    if (!user || !terminal || !isSuccess) return;
    const aindaExiste = terminaisAtivos.some((t) => t.id === terminal.id);
    if (!aindaExiste) {
      toast.warning(
        "O terminal vinculado a este dispositivo não existe mais. Selecione outro.",
      );
      setTerminal(null);
    } else {
      // Mantém o nome sincronizado caso tenha sido renomeado
      const atualizado = terminaisAtivos.find((t) => t.id === terminal.id);
      if (atualizado && atualizado.nome !== terminal.nome) {
        setTerminal({ id: atualizado.id, nome: atualizado.nome });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, terminal?.id, isSuccess, terminaisAtivos]);

  return (
    <TerminalContext.Provider
      value={{ terminal, setTerminal, limparTerminal }}
    >
      {children}
    </TerminalContext.Provider>
  );
}

export function useTerminal() {
  const ctx = useContext(TerminalContext);
  if (!ctx)
    throw new Error("useTerminal deve ser usado dentro de <TerminalProvider>");
  return ctx;
}
