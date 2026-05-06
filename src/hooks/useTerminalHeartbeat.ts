import { useEffect, useRef } from "react";
import { dataClient } from "@/integrations/data/client";
import { useTerminal } from "@/components/auth/TerminalProvider";
import { useOperador } from "@/components/auth/OperadorProvider";

const HEARTBEAT_MS = 30_000;

/**
 * Mantém o terminal "online" no servidor enviando um heartbeat
 * a cada 30s enquanto o app PDV estiver aberto.
 *
 * Também envia o operador logado e o user-agent para que o admin
 * veja em Configurações → Terminais quem está usando cada caixa.
 *
 * Use este hook DENTRO do shell do PDV (rota /pos e /pdv).
 */
export function useTerminalHeartbeat() {
  const { terminal } = useTerminal();
  const { operador } = useOperador();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!terminal) return;

    function ping() {
      if (!terminal) return;
      void dataClient.terminalRuntime.heartbeat({
        terminal_id: terminal.id,
        operador_id: operador?.id ?? null,
        operador_nome: operador?.nome ?? null,
        user_agent:
          typeof navigator !== "undefined"
            ? navigator.userAgent.slice(0, 240)
            : null,
        ip_local: null,
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
