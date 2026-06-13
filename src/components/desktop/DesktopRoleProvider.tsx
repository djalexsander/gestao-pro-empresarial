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
  hydrateDesktopConfig,
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
import { useLocalServerBoot } from "./useLocalServerBoot";
import { LocalServerStatusIndicator } from "./LocalServerStatusIndicator";

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
  const [hidratado, setHidratado] = useState<boolean>(!desktop);

  // Aguarda hidratação inicial (Tauri Store é assíncrono).
  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    void hydrateDesktopConfig().then(() => {
      if (cancelled) return;
      setConfigState(getDesktopConfig());
      setHidratado(true);
    });
    return () => {
      cancelled = true;
    };
  }, [desktop]);

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
      precisaConfigurar: desktop && hidratado && config.role === "unset",
      definirRole,
      salvarConfig,
      resetar,
    }),
    [desktop, config, hidratado, definirRole, salvarConfig, resetar],
  );

  return (
    <DesktopRoleContext.Provider value={value}>
      <LocalServerBootGate />
      <LocalServerStatusIndicator />
      {children}
    </DesktopRoleContext.Provider>
  );
}

/**
 * Componente interno: roda o boot do backend local quando a máquina for
 * Servidor. Vive dentro do provider para ter acesso ao contexto.
 */
function LocalServerBootGate() {
  useLocalServerBoot();
  return null;
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
