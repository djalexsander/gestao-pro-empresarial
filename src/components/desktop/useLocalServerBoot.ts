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
import {
  registerLocalServerAuth,
  clearLocalServerAuth,
} from "@/integrations/desktop/serverConnection";
import {
  getDesktopConfig,
  setDesktopConfig,
} from "@/integrations/desktop/configStore";

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
  authToken: string | null;
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
      authToken: opts.authToken,
    });
    STATE.lastStatus = st;
    console.log("[boot] start_local_server resultado", st);

    // Persiste o token retornado pelo backend caso ainda não tenhamos
    // nenhum salvo (primeira execução). NUNCA troca um token já salvo —
    // isso quebraria terminais já pareados em hot-reload.
    if (st.auth_token) {
      const baseUrl = `http://127.0.0.1:${st.port ?? opts.port}`;
      registerLocalServerAuth(baseUrl, st.auth_token);
      const current = getDesktopConfig();
      if (!current.serverAuthToken) {
        setDesktopConfig({
          ...current,
          serverAuthToken: st.auth_token,
          atualizadoEm: Date.now(),
        });
      }
    }

    if (st.running) {
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

  // Mantém o registro de token sempre alinhado com a config persistida.
  // - server: registra token para 127.0.0.1:porta
  // - terminal: registra token (config.terminal.serverToken) para host:porta
  useEffect(() => {
    if (!desk) return;
    if (role === "server" && config.serverAuthToken) {
      const port = config.terminal?.porta ?? DEFAULT_LOCAL_PORT;
      registerLocalServerAuth(`http://127.0.0.1:${port}`, config.serverAuthToken);
    } else if (role === "terminal" && config.terminal?.serverToken) {
      const host = config.terminal.host?.replace(/^https?:\/\//, "").replace(/\/+$/, "");
      if (host && config.terminal.porta) {
        registerLocalServerAuth(
          `http://${host}:${config.terminal.porta}`,
          config.terminal.serverToken,
        );
      }
    }
  }, [
    desk,
    role,
    config.serverAuthToken,
    config.terminal?.serverToken,
    config.terminal?.host,
    config.terminal?.porta,
  ]);

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
        // Reaproveita o token persistido — backend NÃO gera um novo nesse caso.
        authToken: config.serverAuthToken ?? null,
      });
    } else if (startedRef.current) {
      void stopLocalServer().catch(() => {});
      clearLocalServerAuth();
      startedRef.current = false;
    }
  }, [
    desk,
    role,
    config.terminal?.porta,
    config.serverNome,
    config.serverId,
    config.terminal?.terminalNome,
    // Propositalmente NÃO incluímos config.serverAuthToken aqui — não queremos
    // reiniciar o servidor (nem trocar token) só porque o token mudou via UI.
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
      authToken: config.serverAuthToken ?? null,
    });
  }, [
    config.terminal?.porta,
    config.serverNome,
    config.serverId,
    config.terminal?.terminalNome,
    config.serverAuthToken,
  ]);

  return {
    starting: STATE.starting,
    lastError: STATE.lastError,
    lastStatus: STATE.lastStatus,
    start,
  };
}
