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

  const cfgTerminal: TerminalConexaoConfig | undefined =
    role === "terminal" ? config.terminal : undefined;

  const cfgServer: TerminalConexaoConfig | undefined =
    role === "server" && daemon?.running && daemon.port
      ? {
          host: "127.0.0.1",
          porta: daemon.port,
          terminalId: "self",
          terminalNome: daemon.server_name ?? "Servidor",
        }
      : undefined;

  const cfgPing = cfgTerminal ?? cfgServer;

  const ping = useCallback(async () => {
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
      setConn(result);

      // Quando online, enriquece com /server-info.
      if (result.status === "online") {
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
        setInfo(null);
        setServerMatch(null);
      }
    } finally {
      setTestando(false);
    }
  }, [isDesktop, role, cfgPing, cfgTerminal, config.machineId]);

  useEffect(() => {
    if (!isDesktop || role === "unset") {
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
