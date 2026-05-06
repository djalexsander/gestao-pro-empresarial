import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useModosDisponiveis, type ModoDisponivel } from "@/hooks/useSaasAdmin";

interface ModeContextValue {
  /** Modo atualmente ativo (chave). null = nenhum selecionado. */
  modoAtual: ModoDisponivel | null;
  /** Lista de modos disponíveis (ativos). */
  modos: ModoDisponivel[];
  isLoading: boolean;
  /** Define o modo atual e persiste em storage. */
  setModo: (chave: string) => void;
  /** Limpa o modo (volta pro hub de escolha). */
  clearModo: () => void;
  /** Retorna true se a rota informada pertence ao modo atual. */
  isRouteAllowed: (pathname: string) => boolean;
}

const ModeContext = createContext<ModeContextValue | null>(null);
const STORAGE_KEY = "app:modo-atual";

/** Rotas sempre liberadas independente de modo (auth, hub, admin master, etc.). */
const ROTAS_GLOBAIS = ["/auth", "/hub", "/admin", "/planos", "/modulos"];

/** Mapeia rotas conhecidas a um modo (chave). */
function rotasDoModo(modoChave: string): string[] {
  if (modoChave === "pdv") return ["/pos", "/pdv"];
  if (modoChave === "erp") {
    return [
      "/", "/produtos-vendidos", "/produtos", "/estoque", "/compras", "/vendas", "/caixa",
      "/financeiro", "/fornecedores", "/clientes",
      "/relatorios", "/configuracoes",
    ];
  }
  return [];
}

export function ModeProvider({ children }: { children: ReactNode }) {
  const { data: modos = [], isLoading } = useModosDisponiveis();
  const [chaveAtual, setChaveAtual] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(STORAGE_KEY);
  });

  // Se o modo persistido não existe mais (foi desativado), limpa.
  useEffect(() => {
    if (!chaveAtual || isLoading) return;
    if (!modos.find((m) => m.chave === chaveAtual)) {
      setChaveAtual(null);
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, [modos, chaveAtual, isLoading]);

  const modoAtual = useMemo(
    () => modos.find((m) => m.chave === chaveAtual) ?? null,
    [modos, chaveAtual],
  );

  const value: ModeContextValue = {
    modoAtual,
    modos,
    isLoading,
    setModo: (chave) => {
      setChaveAtual(chave);
      window.localStorage.setItem(STORAGE_KEY, chave);
    },
    clearModo: () => {
      setChaveAtual(null);
      window.localStorage.removeItem(STORAGE_KEY);
    },
    isRouteAllowed: (pathname) => {
      if (ROTAS_GLOBAIS.some((p) => pathname === p || pathname.startsWith(p + "/"))) return true;
      if (!chaveAtual) return false;
      const permitidas = rotasDoModo(chaveAtual);
      return permitidas.some((base) => {
        if (base === "/") return pathname === "/";
        return pathname === base || pathname.startsWith(base + "/");
      });
    },
  };

  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>;
}

export function useMode() {
  const ctx = useContext(ModeContext);
  if (!ctx) throw new Error("useMode deve ser usado dentro de <ModeProvider>");
  return ctx;
}
