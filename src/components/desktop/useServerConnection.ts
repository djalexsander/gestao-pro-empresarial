import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDesktopRole } from "@/components/desktop/DesktopRoleProvider";
import {
  enviarHeartbeatLocal,
  fetchServerInfo,
  pingServidorLocal,
  registerLocalServerAuth,
  type ServerConnInfo,
  type ServerInfoPayload,
} from "@/integrations/desktop/serverConnection";
import {
  getLocalServerStatus,
  type LocalServerStatus,
} from "@/integrations/desktop/tauriBridge";
import type { TerminalConexaoConfig } from "@/integrations/desktop/types";
import { setDesktopConfig } from "@/integrations/desktop/configStore";
import { APP_VERSION } from "@/lib/version";

const POLL_MS = 15_000;
const OFFLINE_FAILURE_THRESHOLD = 3;
const KEEP_LAST_ONLINE_MS = 60_000;
const DEFAULT_LOCAL_PORT = 3333;

const INITIAL: ServerConnInfo = {
  status: "unknown",
  latenciaMs: null,
  ultimoSync: null,
  baseUrl: null,
};

interface UseServerConnectionResult {
  conn: ServerConnInfo;
  info: ServerInfoPayload | null;
  daemon: LocalServerStatus | null;
  serverMatch: boolean | null;
  reverificar: () => Promise<void>;
  testando: boolean;
}

export function useServerConnection(): UseServerConnectionResult {
  const { isDesktop, role, config } = useDesktopRole();
  const [conn, setConn] = useState<ServerConnInfo>(INITIAL);
  const [info, setInfo] = useState<ServerInfoPayload | null>(null);
  const [daemon, setDaemon] = useState<LocalServerStatus | null>(null);
  const [serverMatch, setServerMatch] = useState<boolean | null>(null);
  const [testando, setTestando] = useState(false);
  const inFlight = useRef(false);
  const consecutiveFailures = useRef(0);
  const lastOnline = useRef<ServerConnInfo | null>(null);

  const cfgTerminal = useMemo<TerminalConexaoConfig | undefined>(
    () => (role === "terminal" ? config.terminal : undefined),
    [role, config.terminal],
  );

  const cfgServer = useMemo<TerminalConexaoConfig | undefined>(() => {
    if (role !== "server") return undefined;
    return {
      host: "127.0.0.1",
      porta:
        daemon?.port ??
        config.serverPort ??
        config.terminal?.porta ??
        DEFAULT_LOCAL_PORT,
      terminalId: "self",
      terminalNome: daemon?.server_name ?? config.serverNome ?? "Servidor",
    };
  }, [
    role,
    daemon?.port,
    daemon?.server_name,
    config.serverPort,
    config.terminal?.porta,
    config.serverNome,
  ]);

  const cfgPing = useMemo(
    () => cfgTerminal ?? cfgServer,
    [cfgTerminal, cfgServer],
  );

  const ping = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setTestando(true);
    try {
      if (isDesktop && role === "server") {
        try {
          const status = await getLocalServerStatus();
          setDaemon(status);
          if (status.auth_token) {
            const port =
              status.port ??
              config.serverPort ??
              config.terminal?.porta ??
              DEFAULT_LOCAL_PORT;
            registerLocalServerAuth(
              `http://127.0.0.1:${port}`,
              status.auth_token,
            );
            if (!config.serverAuthToken) {
              setDesktopConfig({
                ...config,
                serverAuthToken: status.auth_token,
                serverPort: port,
              });
            }
          }
        } catch (error) {
          console.warn("[useServerConnection] status do daemon falhou", error);
        }
      }

      const result = await pingServidorLocal(cfgPing);
      if (result.status === "online") {
        consecutiveFailures.current = 0;
        lastOnline.current = result;
        setConn(result);

        const serverInfo = await fetchServerInfo(cfgPing);
        setInfo(serverInfo);
        if (role === "server" && serverInfo?.host) {
          const port =
            serverInfo.port ??
            config.serverPort ??
            config.terminal?.porta ??
            DEFAULT_LOCAL_PORT;
          const networkBaseUrl = `http://${serverInfo.host}:${port}`;
          if (
            config.networkHost !== serverInfo.host ||
            config.networkBaseUrl !== networkBaseUrl
          ) {
            setDesktopConfig({
              ...config,
              networkHost: serverInfo.host,
              networkBaseUrl,
              serverPort: port,
            });
          }
        }

        if (role === "terminal" && cfgTerminal) {
          const heartbeat = await enviarHeartbeatLocal(cfgTerminal, {
            terminal_id: cfgTerminal.terminalId,
            terminal_nome: cfgTerminal.terminalNome,
            machine_id: config.machineId,
            role: "terminal",
            app_version: APP_VERSION,
            expected_server_id: serverInfo?.server_id ?? null,
          });
          if (heartbeat) setServerMatch(heartbeat.serverMatch ?? null);
        }
        return;
      }

      consecutiveFailures.current += 1;
      console.warn("[useServerConnection] health fail", {
        failures: consecutiveFailures.current,
        status: result.status,
        baseUrl: result.baseUrl,
        message: result.mensagem ?? null,
      });

      const last = lastOnline.current;
      const lastIsFresh =
        !!last?.ultimoSync &&
        Date.now() - last.ultimoSync.getTime() <= KEEP_LAST_ONLINE_MS;
      if (
        last &&
        lastIsFresh &&
        consecutiveFailures.current < OFFLINE_FAILURE_THRESHOLD
      ) {
        setConn({
          ...last,
          ultimoSync: new Date(),
          mensagem: "Servidor local instável. Tentando reconectar...",
        });
      } else if (consecutiveFailures.current < OFFLINE_FAILURE_THRESHOLD) {
        setConn({
          status: "unknown",
          latenciaMs: null,
          ultimoSync: new Date(),
          baseUrl: result.baseUrl,
          mensagem: "Reconectando servidor local...",
        });
      } else {
        setConn(result);
        setInfo(null);
        setServerMatch(null);
      }
    } finally {
      inFlight.current = false;
      setTestando(false);
    }
  }, [
    isDesktop,
    role,
    config,
    cfgPing,
    cfgTerminal,
  ]);

  useEffect(() => {
    if (!isDesktop || role === "unset") {
      consecutiveFailures.current = 0;
      lastOnline.current = null;
      setConn({
        status: "cloud-fallback",
        latenciaMs: null,
        ultimoSync: new Date(),
        baseUrl: null,
        mensagem: "Aplicacao usando cloud.",
      });
      return;
    }

    void ping();
    const timer = setInterval(() => void ping(), POLL_MS);
    return () => clearInterval(timer);
  }, [isDesktop, role, ping]);

  return {
    conn,
    info,
    daemon,
    serverMatch,
    reverificar: ping,
    testando,
  };
}
