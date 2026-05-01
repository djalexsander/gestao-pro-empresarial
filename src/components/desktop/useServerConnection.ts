/**
 * ============================================================================
 * useServerConnection — status real da conexão com o servidor local
 * ============================================================================
 *
 * Para o modo TERMINAL: faz ping periódico ao /health do servidor.
 * Para o modo SERVER:    faz ping ao próprio backend embutido (localhost) +
 *                        consulta o status do daemon Rust.
 * Em web:                retorna `cloud-fallback` estático.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useDesktopRole } from "@/components/desktop/DesktopRoleProvider";
import {
  pingServidorLocal,
  type ServerConnInfo,
} from "@/integrations/desktop/serverConnection";
import {
  getLocalServerStatus,
  type LocalServerStatus,
} from "@/integrations/desktop/tauriBridge";
import type { TerminalConexaoConfig } from "@/integrations/desktop/types";

const POLL_MS = 20_000;

const INITIAL: ServerConnInfo = {
  status: "unknown",
  latenciaMs: null,
  ultimoSync: null,
  baseUrl: null,
};

interface UseServerConnectionResult {
  conn: ServerConnInfo;
  /** Status do daemon local (apenas relevante no modo server). */
  daemon: LocalServerStatus | null;
  /** Recheck imediato. */
  reverificar: () => Promise<void>;
  /** True enquanto um ping manual está em curso. */
  testando: boolean;
}

export function useServerConnection(): UseServerConnectionResult {
  const { isDesktop, role, config } = useDesktopRole();
  const [conn, setConn] = useState<ServerConnInfo>(INITIAL);
  const [daemon, setDaemon] = useState<LocalServerStatus | null>(null);
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
    } finally {
      setTestando(false);
    }
  }, [isDesktop, role, cfgPing]);

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

  return { conn, daemon, reverificar: ping, testando };
}
