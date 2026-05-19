/**
 * Boot do backend local — só faz algo quando rodando como Desktop em
 * modo "server". Em web, terminal ou unset, é no-op silencioso.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useDesktopRole } from "./DesktopRoleProvider";
import {
  startLocalServer,
  stopLocalServer,
  type LocalServerStatus,
} from "@/integrations/desktop/tauriBridge";
import { isDesktop } from "@/integrations/data/mode";

export const DEFAULT_LOCAL_PORT = 3333;

export interface BootState {
  starting: boolean;
  lastError: string | null;
  lastStatus: LocalServerStatus | null;
  start: () => Promise<LocalServerStatus | null>;
}

const STATE: BootState & { listeners: Set<() => void> } = {
  starting: false,
  lastError: null,
  lastStatus: null,
  start: async () => null,
  listeners: new Set(),
};

function notify() {
  STATE.listeners.forEach((l) => l());
}

async function doStart(opts: {
  port: number;
  serverName: string | null;
  serverId: string | null;
}): Promise<LocalServerStatus | null> {
  if (!isDesktop()) {
    console.warn("[boot] doStart ignorado — não está em Tauri");
    return null;
  }
  if (STATE.starting) {
    console.log("[boot] start já em andamento, ignorando duplicata");
    return STATE.lastStatus;
  }
  STATE.starting = true;
  STATE.lastError = null;
  notify();
  const upstreamUrl =
    (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? null;
  const upstreamAnonKey =
    (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? null;
  console.log("[boot] invocando start_local_server", { port: opts.port });
  try {
    const st = await startLocalServer({
      port: opts.port,
      serverName: opts.serverName,
      serverId: opts.serverId,
      upstreamUrl,
      upstreamAnonKey,
    });
    STATE.lastStatus = st;
    console.log("[boot] start_local_server resultado", st);
    if (st.running) {
      console.log("[AUTO_SYNC] servidor local iniciado — auto-sync agendado");
      toast.success(`Backend local iniciado na porta ${st.port ?? opts.port}.`);
    } else {
      STATE.lastError = "O backend não confirmou execução.";
      toast.error(STATE.lastError);
    }
    return st;
  } catch (err) {
    const msg = String(err);
    STATE.lastError = msg;
    console.error("[boot] start_local_server falhou", err);
    toast.error(`Não foi possível iniciar o backend local: ${msg}`);
    return null;
  } finally {
    STATE.starting = false;
    notify();
  }
}

/** Hook do boot automático — montado no DesktopRoleProvider. */
export function useLocalServerBoot() {
  const { isDesktop: desk, role, config } = useDesktopRole();
  const startedRef = useRef(false);

  useEffect(() => {
    console.log("[boot] check", { isDesktop: desk, role, started: startedRef.current });
    if (!desk) return;

    if (role === "server") {
      if (startedRef.current) return;
      startedRef.current = true;
      const port = config.terminal?.porta ?? DEFAULT_LOCAL_PORT;
      const nome =
        config.serverNome ??
        config.terminal?.terminalNome ??
        "Servidor Gestão Pro";
      void doStart({
        port,
        serverName: nome,
        serverId: config.serverId ?? null,
      });
    } else if (startedRef.current) {
      void stopLocalServer().catch(() => {});
      startedRef.current = false;
    }
  }, [
    desk,
    role,
    config.terminal?.porta,
    config.serverNome,
    config.serverId,
    config.terminal?.terminalNome,
  ]);
}

/** Hook para componentes que querem disparar/observar o boot manualmente. */
export function useBootController(): BootState {
  const { config } = useDesktopRole();
  const [, force] = useState(0);

  useEffect(() => {
    const listener = () => force((n) => n + 1);
    STATE.listeners.add(listener);
    return () => {
      STATE.listeners.delete(listener);
    };
  }, []);

  const start = useCallback(async () => {
    const port = config.terminal?.porta ?? DEFAULT_LOCAL_PORT;
    const nome =
      config.serverNome ??
      config.terminal?.terminalNome ??
      "Servidor Gestão Pro";
    return doStart({
      port,
      serverName: nome,
      serverId: config.serverId ?? null,
    });
  }, [config.terminal?.porta, config.serverNome, config.serverId, config.terminal?.terminalNome]);

  return {
    starting: STATE.starting,
    lastError: STATE.lastError,
    lastStatus: STATE.lastStatus,
    start,
  };
}
