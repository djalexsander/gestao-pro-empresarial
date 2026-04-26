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

const STORAGE_PREFIX = "gp.terminal:";
/** Chave legada (antes do isolamento por usuário) — limpamos para evitar vazamento. */
const LEGACY_STORAGE_KEY = "gp.terminal";

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

function storageKeyFor(userId: string | null | undefined): string | null {
  if (!userId) return null;
  return STORAGE_PREFIX + userId;
}

function loadFromStorage(userId: string | null | undefined): TerminalSelecionado | null {
  if (typeof window === "undefined") return null;
  const key = storageKeyFor(userId);
  if (!key) return null;
  try {
    // Limpa chave legada (sem isolamento por usuário) para impedir
    // que o terminal de uma empresa vaze para outra conta no mesmo navegador.
    if (localStorage.getItem(LEGACY_STORAGE_KEY)) {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as TerminalSelecionado;
  } catch {
    return null;
  }
}

/**
 * Persiste o terminal selecionado deste dispositivo em localStorage,
 * **isolado por usuário autenticado**. Cada conta tem seu próprio terminal
 * vinculado neste dispositivo — não há vazamento entre empresas.
 *
 * Também valida o terminal armazenado contra a lista atual de terminais
 * ativos da empresa do usuário logado: se foi excluído, desativado ou
 * pertence a outra empresa, limpa o cache para forçar nova seleção.
 */
export function TerminalProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [terminal, setTerminalState] = useState<TerminalSelecionado | null>(null);

  const setTerminal = useCallback(
    (t: TerminalSelecionado | null) => {
      setTerminalState(t);
      const key = storageKeyFor(user?.id);
      if (!key) return;
      try {
        if (t) localStorage.setItem(key, JSON.stringify(t));
        else localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
    [user?.id],
  );

  const limparTerminal = useCallback(() => setTerminal(null), [setTerminal]);

  // Re-hidrata sempre que o usuário muda (login/logout/troca de conta).
  useEffect(() => {
    if (!user) {
      setTerminalState(null);
      return;
    }
    const t = loadFromStorage(user.id);
    setTerminalState(t);
  }, [user?.id]);

  // Valida o terminal armazenado contra a lista real do servidor.
  const { data: terminaisAtivos = [], isSuccess } = useTerminaisAtivos();

  useEffect(() => {
    if (!user || !terminal || !isSuccess) return;
    const aindaExiste = terminaisAtivos.some((t) => t.id === terminal.id);
    if (!aindaExiste) {
      toast.warning(
        "O terminal vinculado a este dispositivo não existe mais nesta empresa. Selecione outro.",
      );
      setTerminal(null);
    } else {
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
