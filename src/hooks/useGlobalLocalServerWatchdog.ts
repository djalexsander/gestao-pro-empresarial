/**
 * useGlobalLocalServerWatchdog — Onda 1 (finalização)
 *
 * Monta o watchdog em nível de aplicação (AppLayout) para que a recuperação
 * automática do servidor local desktop funcione em qualquer tela, e não
 * apenas quando o usuário abre Configurações → Desktop.
 *
 * No-op em web/PWA e em desktops configurados como "terminal" (que se
 * conectam a outro PC). Em desktop em qualquer outro papel, polia o status
 * a cada 15s e tenta reiniciar com backoff caso o daemon caia.
 */
import { useMemo } from "react";
import { useDesktopRole } from "@/components/desktop/DesktopRoleProvider";
import { useLocalServerWatchdog } from "./useLocalServerWatchdog";
import { DEFAULT_LOCAL_PORT } from "@/components/desktop/useLocalServerBoot";
import type { StartLocalServerOptions } from "@/integrations/desktop/tauriBridge";

export function useGlobalLocalServerWatchdog() {
  const { isDesktop: desk, role, config } = useDesktopRole();

  const enabled = desk && role !== "terminal";

  const startOptions = useMemo<StartLocalServerOptions | null>(() => {
    if (!enabled) return null;
    const port = config.terminal?.porta ?? DEFAULT_LOCAL_PORT;
    const nome =
      config.serverNome ??
      config.terminal?.terminalNome ??
      "Servidor Gestão Pro";
    return {
      port,
      serverName: nome,
      serverId: config.serverId ?? null,
      upstreamUrl:
        (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? null,
      upstreamAnonKey:
        (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as
          | string
          | undefined) ?? null,
    };
  }, [
    enabled,
    config.terminal?.porta,
    config.serverNome,
    config.serverId,
    config.terminal?.terminalNome,
  ]);

  useLocalServerWatchdog(startOptions, enabled);
}
