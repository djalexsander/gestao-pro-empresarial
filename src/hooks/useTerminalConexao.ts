import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getDataMode } from "@/integrations/data/mode";
import { getDesktopConfig } from "@/integrations/desktop/configStore";
import { pingServidorLocal } from "@/integrations/desktop/serverConnection";

/**
 * Estado de conexão do terminal cliente com o servidor (Lovable Cloud).
 *
 * Como a arquitetura é nuvem, "conectar ao servidor" = ter internet + responder
 * ao RPC `terminal_ping`. Não há host/IP/porta para configurar — a base central
 * é a própria nuvem e todos os terminais já apontam para ela.
 *
 * Este hook:
 *  - faz ping a cada 15s para medir latência
 *  - escuta `online`/`offline` do navegador
 *  - tenta reconectar automaticamente (backoff) quando cai
 *  - expõe `reconectarAgora()` para o botão manual
 */
export type ConexaoStatus = "online" | "offline" | "reconectando";

export interface ConexaoInfo {
  status: ConexaoStatus;
  latenciaMs: number | null;
  ultimoSync: Date | null;
  tentativas: number;
  reconectarAgora: () => void;
}

const PING_INTERVAL = 15_000;
const BACKOFF_MAX = 30_000;

export function useTerminalConexao(): ConexaoInfo {
  const [status, setStatus] = useState<ConexaoStatus>(
    typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "online",
  );
  const [latenciaMs, setLatenciaMs] = useState<number | null>(null);
  const [ultimoSync, setUltimoSync] = useState<Date | null>(null);
  const [tentativas, setTentativas] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ping = useCallback(async (): Promise<boolean> => {
    const mode = getDataMode();
    const isLocalMode = mode === "local-server" || mode === "local-terminal";
    if (!isLocalMode && typeof navigator !== "undefined" && !navigator.onLine) {
      setStatus("offline");
      return false;
    }
    const t0 = performance.now();
    try {
      if (isLocalMode) {
        const cfg = getDesktopConfig();
        const terminalCfg =
          cfg.role === "server"
            ? {
                host: "127.0.0.1",
                porta: cfg.terminal?.porta ?? 3333,
                terminalId: "self",
                terminalNome: cfg.serverNome ?? "Servidor",
                serverToken: cfg.serverAuthToken,
              }
            : cfg.terminal;
        const local = await pingServidorLocal(terminalCfg);
        if (local.status !== "online") throw new Error(local.mensagem ?? "Servidor local offline");
        setLatenciaMs(local.latenciaMs);
        setUltimoSync(new Date());
        setStatus("online");
        setTentativas(0);
        return true;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("terminal_ping");
      if (error) throw error;
      const dt = Math.round(performance.now() - t0);
      setLatenciaMs(dt);
      setUltimoSync(new Date());
      setStatus("online");
      setTentativas(0);
      return true;
    } catch {
      setStatus((prev) => (prev === "online" ? "reconectando" : prev));
      setTentativas((n) => n + 1);
      return false;
    }
  }, []);

  const agendarProximo = useCallback(
    (delay: number) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        const ok = await ping();
        agendarProximo(
          ok
            ? PING_INTERVAL
            : Math.min(BACKOFF_MAX, 1000 * Math.pow(2, tentativas)),
        );
      }, delay);
    },
    [ping, tentativas],
  );

  useEffect(() => {
    // Ping inicial
    void ping().then((ok) =>
      agendarProximo(ok ? PING_INTERVAL : 2_000),
    );

    function onOnline() {
      setStatus("reconectando");
      void ping();
    }
    function onOffline() {
      setStatus("offline");
      setLatenciaMs(null);
    }
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reconectarAgora = useCallback(() => {
    setTentativas(0);
    setStatus("reconectando");
    void ping().then((ok) => agendarProximo(ok ? PING_INTERVAL : 2_000));
  }, [ping, agendarProximo]);

  return { status, latenciaMs, ultimoSync, tentativas, reconectarAgora };
}
