import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  clearDesktopConfig,
  getDesktopConfig,
  setDesktopConfig,
  setDesktopRole,
  subscribeDesktopConfig,
} from "@/integrations/desktop/configStore";
import {
  DESKTOP_CONFIG_DEFAULT,
  type DesktopConfig,
  type DesktopRole,
  type TerminalConexaoConfig,
} from "@/integrations/desktop/types";
import { isDesktop } from "@/integrations/data/mode";

interface DesktopRoleContextValue {
  /** True quando rodando no shell desktop (Tauri). */
  isDesktop: boolean;
  /** Configuração atual completa. */
  config: DesktopConfig;
  /** Atalho para o papel atual. `unset` enquanto não passou pelo wizard. */
  role: DesktopRole;
  /** True se desktop e ainda não foi configurado. */
  precisaConfigurar: boolean;
  /** Define apenas o papel (com config opcional para terminal). */
  definirRole: (role: DesktopRole, terminal?: TerminalConexaoConfig) => void;
  /** Substitui toda a configuração. */
  salvarConfig: (cfg: DesktopConfig) => void;
  /** Limpa tudo (volta para `unset`). */
  resetar: () => void;
}

const DesktopRoleContext = createContext<DesktopRoleContextValue | null>(null);

export function DesktopRoleProvider({ children }: { children: ReactNode }) {
  const desktop = isDesktop();
  const [config, setConfigState] = useState<DesktopConfig>(() =>
    desktop ? getDesktopConfig() : { ...DESKTOP_CONFIG_DEFAULT },
  );

  // Mantém em sync com mudanças externas (wizard em outra aba do dev, etc.)
  useEffect(() => {
    if (!desktop) return;
    return subscribeDesktopConfig((cfg) => setConfigState(cfg));
  }, [desktop]);

  const definirRole = useCallback(
    (role: DesktopRole, terminal?: TerminalConexaoConfig) => {
      setDesktopRole(role, terminal);
      setConfigState(getDesktopConfig());
    },
    [],
  );

  const salvarConfig = useCallback((cfg: DesktopConfig) => {
    setDesktopConfig(cfg);
    setConfigState(getDesktopConfig());
  }, []);

  const resetar = useCallback(() => {
    clearDesktopConfig();
    setConfigState({ ...DESKTOP_CONFIG_DEFAULT });
  }, []);

  const value = useMemo<DesktopRoleContextValue>(
    () => ({
      isDesktop: desktop,
      config,
      role: config.role,
      precisaConfigurar: desktop && config.role === "unset",
      definirRole,
      salvarConfig,
      resetar,
    }),
    [desktop, config, definirRole, salvarConfig, resetar],
  );

  return (
    <DesktopRoleContext.Provider value={value}>
      {children}
    </DesktopRoleContext.Provider>
  );
}

export function useDesktopRole(): DesktopRoleContextValue {
  const ctx = useContext(DesktopRoleContext);
  if (!ctx) {
    throw new Error(
      "useDesktopRole deve ser usado dentro de <DesktopRoleProvider>",
    );
  }
  return ctx;
}

/** Helper isolado para usar em guards sem precisar montar o provider. */
export function isDesktopTerminal(): boolean {
  if (!isDesktop()) return false;
  return getDesktopConfig().role === "terminal";
}

export function isDesktopServer(): boolean {
  if (!isDesktop()) return false;
  return getDesktopConfig().role === "server";
}
