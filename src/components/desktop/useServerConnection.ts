/**
 * ============================================================================
 * useServerConnection — status real da conexão com o servidor local
 * ============================================================================
 *
 * Para o modo TERMINAL: faz ping periódico ao /health do servidor + envia
 *                       heartbeat com identidade (terminalId, machineId, role).
 * Para o modo SERVER:    faz ping ao próprio backend embutido (localhost) +
 *                        consulta o status do daemon Rust + lista de terminais.
 * Em web:                retorna `cloud-fallback` estático.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useDesktopRole } from "@/components/desktop/DesktopRoleProvider";
import {
  enviarHeartbeatLocal,
  fetchServerInfo,
  pingServidorLocal,
  type ServerConnInfo,
  type ServerInfoPayload,
} from "@/integrations/desktop/serverConnection";
import {
  getLocalServerStatus,
  startLocalServer,
  type LocalServerStatus,
} from "@/integrations/desktop/tauriBridge";
import type { TerminalConexaoConfig } from "@/integrations/desktop/types";
import { setDesktopConfig } from "@/integrations/desktop/configStore";
import { APP_VERSION } from "@/lib/version";

const POLL_MS = 20_000;
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
  /** /server-info do servidor remoto (terminal) ou local (server). */
  info: ServerInfoPayload | null;
  /** Status do daemon local (apenas relevante no modo server). */
  daemon: LocalServerStatus | null;
  /** Indica se o serverId remoto bate com o esperado pelo terminal. */
  serverMatch: boolean | null;
  /** Recheck imediato. */
  reverificar: () => Promise<void>;
  /** True enquanto um ping manual está em curso. */
  testando: boolean;
}

export function useServerConnection(): UseServerConnectionResult {
  const { isDesktop, role, config } = useDesktopRole();
  const [conn, setConn] = useState<ServerConnInfo>(INITIAL);
  const [info, setInfo] = useState<ServerInfoPayload | null>(null);
  const [daemon, setDaemon] = useState<LocalServerStatus | null>(null);
  const [serverMatch, setServerMatch] = useState<boolean | null>(null);
  const [testando, setTestando] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlight = useRef(false);
  const consecutiveFailures = useRef(0);
  const lastOnline = useRef<ServerConnInfo | null>(null);
  const restartInFlight = useRef(false);

  const cfgTerminal: TerminalConexaoConfig | undefined =
    role === "terminal" ? config.terminal : undefined;

  const cfgServer: TerminalConexaoConfig | undefined =
    role === "server"
      ? {
          host: "127.0.0.1",
          porta: daemon?.port ?? config.serverPort ?? config.terminal?.porta ?? DEFAULT_LOCAL_PORT,
          terminalId: "self",
          terminalNome: daemon?.server_name ?? config.serverNome ?? "Servidor",
        }
      : undefined;

  const cfgPing = cfgTerminal ?? cfgServer;

  const ping = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setTestando(true);
    try {
      // Atualiza status do daemon (só faz algo no desktop server).
      if (isDesktop && role === "server") {
        try {
          const st = await getLocalServerStatus();
          let currentStatus = st;
          if (!st.running && !restartInFlight.current) {
            restartInFlight.current = true;
            const port = st.port ?? config.serverPort ?? config.terminal?.porta ?? DEFAULT_LOCAL_PORT;
            console.warn("[useServerConnection] backend local parado; tentando reiniciar automaticamente", {
              port,
              serverId: config.serverId ?? null,
            });
            try {
              currentStatus = await startLocalServer({
                port,
                serverName:
                  config.serverNome ??
                  config.terminal?.terminalNome ??
                  "Servidor Gestão Pro",
                serverId: config.serverId ?? null,
                upstreamUrl:
                  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? null,
                upstreamAnonKey:
                  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? null,
                authToken: config.serverAuthToken ?? null,
              });
            } catch (error) {
              console.error("[useServerConnection] reinicio automatico do backend local falhou", error);
            } finally {
              restartInFlight.current = false;
            }
          }
          setDaemon(currentStatus);
        } catch {
          /* ignore */
        }
      }
      const result = await pingServidorLocal(cfgPing);

      // Quando online, enriquece com /server-info.
      if (result.status === "online") {
        if (consecutiveFailures.current > 0) {
          console.info("[useServerConnection] health recover", {
            baseUrl: result.baseUrl,
            failures: consecutiveFailures.current,
          });
        }
        consecutiveFailures.current = 0;
        lastOnline.current = result;
        setConn(result);
        const si = await fetchServerInfo(cfgPing);
        setInfo(si);
        if (role === "server" && si?.host) {
          const port = si.port ?? config.serverPort ?? config.terminal?.porta ?? DEFAULT_LOCAL_PORT;
          const networkBaseUrl = `http://${si.host}:${port}`;
          if (config.networkHost !== si.host || config.networkBaseUrl !== networkBaseUrl) {
            console.info("[useServerConnection] persistindo host de rede do servidor", {
              networkHost: si.host,
              networkBaseUrl,
            });
            setDesktopConfig({
              ...config,
              networkHost: si.host,
              networkBaseUrl,
              serverPort: port,
            });
          }
        }

        // Heartbeat do terminal — leva a identidade ao servidor.
        if (role === "terminal" && cfgTerminal) {
          const hb = await enviarHeartbeatLocal(cfgTerminal, {
            terminal_id: cfgTerminal.terminalId,
            terminal_nome: cfgTerminal.terminalNome,
            machine_id: config.machineId,
            role: "terminal",
            app_version: APP_VERSION,
            // Quando soubermos o serverId esperado, validar identidade.
            expected_server_id: si?.server_id ?? null,
          });
          if (hb) setServerMatch(hb.serverMatch ?? null);
        }
      } else {
        consecutiveFailures.current += 1;
        console.warn("[useServerConnection] health fail", {
          status: result.status,
          baseUrl: result.baseUrl,
          failures: consecutiveFailures.current,
          message: result.mensagem ?? null,
        });
        const last = lastOnline.current;
        const lastIsFresh =
          !!last?.ultimoSync &&
          Date.now() - last.ultimoSync.getTime() <= KEEP_LAST_ONLINE_MS;

        if (
          role === "server" &&
          consecutiveFailures.current >= OFFLINE_FAILURE_THRESHOLD &&
          !restartInFlight.current
        ) {
          restartInFlight.current = true;
          const port = config.serverPort ?? config.terminal?.porta ?? DEFAULT_LOCAL_PORT;
          console.warn("[useServerConnection] 3 falhas seguidas de /health; reiniciando backend local", {
            port,
            baseUrl: result.baseUrl,
            lastMessage: result.mensagem ?? null,
          });
          try {
            const restarted = await startLocalServer({
              port,
              serverName:
                config.serverNome ??
                config.terminal?.terminalNome ??
                "Servidor Gestão Pro",
              serverId: config.serverId ?? null,
              upstreamUrl:
                (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? null,
              upstreamAnonKey:
                (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? null,
              authToken: config.serverAuthToken ?? null,
            });
            setDaemon(restarted);
          } catch (error) {
            console.error("[useServerConnection] restart por health falhou", error);
            setConn({
              ...result,
              mensagem: `Servidor local não está pronto. Erro ao reiniciar: ${String(error)}`,
            });
          } finally {
            restartInFlight.current = false;
          }
        }

        if (
          last &&
          lastIsFresh &&
          consecutiveFailures.current < OFFLINE_FAILURE_THRESHOLD
        ) {
          setConn({
            ...last,
            ultimoSync: new Date(),
            mensagem: null,
          });
        } else if (!last && consecutiveFailures.current < OFFLINE_FAILURE_THRESHOLD) {
          setConn({
            status: "unknown",
            latenciaMs: null,
            ultimoSync: new Date(),
            baseUrl: result.baseUrl,
            mensagem: "Verificando servidor local...",
          });
        } else {
          setConn(result);
          setInfo(null);
          setServerMatch(null);
        }
      }
    } finally {
      inFlight.current = false;
      setTestando(false);
    }
  }, [
    isDesktop,
    role,
    cfgPing,
    cfgTerminal,
    config.machineId,
    config.serverPort,
    config.networkHost,
    config.networkBaseUrl,
    config.terminal?.porta,
    config.terminal?.terminalNome,
    config.serverNome,
    config.serverId,
    config.serverAuthToken,
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
        mensagem: "Aplicação está usando Lovable Cloud.",
      });
      return;
    }

    if (role === "server" && cfgServer) {
      const baseUrl = `http://${cfgServer.host}:${cfgServer.porta}`;
      console.info("[useServerConnection] baseUrl server resolvida", {
        baseUrl,
        port: cfgServer.porta,
      });
      setConn((prev) => ({
        ...prev,
        status: prev.status === "online" ? prev.status : "unknown",
        baseUrl,
        ultimoSync: prev.ultimoSync ?? new Date(),
        mensagem: prev.status === "online" ? prev.mensagem : "Verificando servidor local...",
      }));
    }

    void ping();
    timer.current = setInterval(() => void ping(), POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [isDesktop, role, ping, cfgServer]);

  return { conn, info, daemon, serverMatch, reverificar: ping, testando };
}
