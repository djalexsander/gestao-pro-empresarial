/**
 * useLocalServerWatchdog — Etapa 12
 *
 * Watchdog leve do servidor local desktop. Polia o status do daemon a cada
 * 15s; quando detecta queda inesperada (estava `running` e parou), tenta
 * reiniciar com backoff (1s, 3s, 8s, 20s) até 4 vezes. Após esgotar, expõe
 * `failed=true` para a UI mostrar erro discreto sem travar a aplicação.
 *
 * Mantém o pino: NÃO sobe servidor se nunca esteve rodando — só recupera
 * quedas. Boot inicial continua sendo responsabilidade da tela de
 * Configurações.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import {
  getLocalServerStatus,
  startLocalServer,
  type LocalServerStatus,
  type StartLocalServerOptions,
} from "@/integrations/desktop/tauriBridge";
import { isDesktop } from "@/integrations/data/mode";

const POLL_MS = 15_000;
const BACKOFF_MS = [1_000, 3_000, 8_000, 20_000];

export interface WatchdogState {
  status: LocalServerStatus | null;
  restarting: boolean;
  restartAttempts: number;
  failed: boolean;
  lastRestartAt: number | null;
  lastError: string | null;
}

export function useLocalServerWatchdog(
  startOptions?: StartLocalServerOptions | null,
  enabled = true,
): WatchdogState & { restartNow: () => Promise<void> } {
  const [state, setState] = useState<WatchdogState>({
    status: null,
    restarting: false,
    restartAttempts: 0,
    failed: false,
    lastRestartAt: null,
    lastError: null,
  });

  const wasRunningRef = useRef(false);
  const attemptsRef = useRef(0);
  const restartingRef = useRef(false);
  const mountedRef = useRef(true);

  const tryRestart = useCallback(async () => {
    if (!startOptions || restartingRef.current) return;
    restartingRef.current = true;
    setState((s) => ({ ...s, restarting: true }));
    for (let i = attemptsRef.current; i < BACKOFF_MS.length; i++) {
      const wait = BACKOFF_MS[i];
      console.warn(
        `[LOCAL_SERVER_WATCHDOG] tentativa de restart #${i + 1} em ${wait}ms`,
      );
      await new Promise((r) => setTimeout(r, wait));
      if (!mountedRef.current) return;
      try {
        const next = await startLocalServer(startOptions);
        console.log("[LOCAL_SERVER_RESTART] OK", next);
        if (next.running) {
          attemptsRef.current = 0;
          wasRunningRef.current = true;
          setState({
            status: next,
            restarting: false,
            restartAttempts: i + 1,
            failed: false,
            lastRestartAt: Date.now(),
            lastError: null,
          });
          restartingRef.current = false;
          return;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[LOCAL_SERVER_RESTART] falhou: ${msg}`);
        attemptsRef.current = i + 1;
        setState((s) => ({
          ...s,
          restartAttempts: i + 1,
          lastError: msg,
        }));
      }
    }
    restartingRef.current = false;
    setState((s) => ({ ...s, restarting: false, failed: true }));
    console.error("[LOCAL_SERVER_WATCHDOG] esgotou tentativas de restart");
  }, [startOptions]);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled || !isDesktop()) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const st = await getLocalServerStatus();
        if (cancelled) return;
        setState((s) => ({ ...s, status: st }));
        if (st.running) {
          wasRunningRef.current = true;
          attemptsRef.current = 0;
          if (state.failed) setState((s) => ({ ...s, failed: false }));
        } else if (wasRunningRef.current && !restartingRef.current && startOptions) {
          console.warn("[LOCAL_SERVER_WATCHDOG] servidor caiu — iniciando restart");
          void tryRestart();
        }
      } catch (e) {
        console.warn("[LOCAL_SERVER_WATCHDOG] poll falhou", e);
      }
    };

    void tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      mountedRef.current = false;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, startOptions?.port, startOptions?.serverId]);

  return { ...state, restartNow: tryRestart };
}
