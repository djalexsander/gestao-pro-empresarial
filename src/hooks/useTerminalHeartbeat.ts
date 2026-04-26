import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
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

    async function ping() {
      if (!terminal) return;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).rpc("terminal_heartbeat", {
          _terminal_id: terminal.id,
          _operador_id: operador?.id ?? null,
          _operador_nome: operador?.nome ?? null,
          _user_agent:
            typeof navigator !== "undefined"
              ? navigator.userAgent.slice(0, 240)
              : null,
          _ip_local: null,
        });
      } catch {
        /* silencioso — não atrapalha operação */
      }
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
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).rpc("terminal_limpar_operador", {
      _terminal_id: terminalId,
    });
  } catch {
    /* silencioso */
  }
}
