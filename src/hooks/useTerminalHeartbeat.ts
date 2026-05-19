import { useEffect, useRef } from "react";
import { dataClient } from "@/integrations/data/client";
import { useTerminal } from "@/components/auth/TerminalProvider";
import { useOperador } from "@/components/auth/OperadorProvider";
import { pingLocalHeartbeat } from "@/integrations/desktop/localTerminalStatus";
import { getDesktopConfig } from "@/integrations/desktop/configStore";
import { APP_VERSION } from "@/lib/version";

const HEARTBEAT_MS = 30_000;

/**
 * Mantém o terminal "online" enviando um heartbeat a cada 30s.
 *
 * Dispara DOIS canais em paralelo, ambos silenciosos e com timeout curto:
 *  - Cloud (Supabase RPC `terminal_heartbeat`) — quando há internet.
 *  - LAN/local (HTTP `POST /heartbeat` no servidor local) — funciona sem
 *    internet, garantindo que terminais conectados ao servidor LAN
 *    apareçam ONLINE mesmo com a nuvem indisponível.
 */
export function useTerminalHeartbeat() {
  const { terminal } = useTerminal();
  const { operador } = useOperador();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!terminal) return;

    function ping() {
      if (!terminal) return;
      const cfg = getDesktopConfig();
      // 1) Cloud (não bloqueia, falha silenciosa)
      void dataClient.terminalRuntime
        .heartbeat({
          terminal_id: terminal.id,
          operador_id: operador?.id ?? null,
          operador_nome: operador?.nome ?? null,
          user_agent:
            typeof navigator !== "undefined"
              ? navigator.userAgent.slice(0, 240)
              : null,
          ip_local: null,
        })
        .catch(() => {
          if (import.meta.env.DEV) {
            console.debug("[TERMINAL_HEARTBEAT] cloud falhou — seguindo via LAN");
          }
        });
      // 2) LAN/local (silencioso, timeout curto)
      void pingLocalHeartbeat({
        terminal_id: terminal.id,
        terminal_nome: terminal.nome ?? cfg.terminal?.terminalNome ?? null,
        machine_id: cfg.machineId ?? null,
        role: cfg.role ?? null,
        app_version: APP_VERSION,
      });
    }

    // Primeiro ping imediato
    ping();
    timer.current = setInterval(ping, HEARTBEAT_MS);

    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [terminal, operador]);
}

/** Limpa o operador atual no terminal (chamar no logout do operador). */
export async function limparOperadorAtual(terminalId: string) {
  await dataClient.terminalRuntime.limparOperador(terminalId);
}
