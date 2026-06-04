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
  type LocalServerStatus,
} from "@/integrations/desktop/tauriBridge";
import type { TerminalConexaoConfig } from "@/integrations/desktop/types";
import { APP_VERSION } from "@/lib/version";

const POLL_MS = 20_000;
const OFFLINE_FAILURE_THRESHOLD = 3;
const KEEP_LAST_ONLINE_MS = 60_000;

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

  const cfgTerminal: TerminalConexaoConfig | undefined =
    role === "terminal" ? config.terminal : undefined;

  const cfgServer: TerminalConexaoConfig | undefined =
    role === "server"
      ? {
          host: "127.0.0.1",
          porta: daemon?.port ?? config.terminal?.porta ?? 3333,
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
          setDaemon(st);
        } catch {
          /* ignore */
        }
      }
      const result = await pingServidorLocal(cfgPing);

      // Quando online, enriquece com /server-info.
      if (result.status === "online") {
        consecutiveFailures.current = 0;
        lastOnline.current = result;
        setConn(result);
        const si = await fetchServerInfo(cfgPing);
        setInfo(si);

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
  }, [isDesktop, role, cfgPing, cfgTerminal, config.machineId]);

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

    void ping();
    timer.current = setInterval(() => void ping(), POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [isDesktop, role, ping]);

  return { conn, info, daemon, serverMatch, reverificar: ping, testando };
}
