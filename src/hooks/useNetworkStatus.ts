import { useEffect, useState } from "react";

/**
 * Hook pra monitorar conexão real com a internet.
 *
 * Estados expostos:
 *  - `checking`  → ainda não confirmamos status (boot / reprobe). Não exibir
 *                  aviso de offline neste estado.
 *  - `online`    → último probe confirmou conectividade.
 *  - `unstable`  → houve **uma** falha de probe; aguardando confirmação.
 *  - `offline`   → `navigator.onLine === false` **ou** N falhas consecutivas
 *                  de probe — só agora consideramos offline confirmado.
 *
 * Para compat retro com componentes existentes, `online: boolean` permanece:
 * é `true` em `checking | online | unstable` e `false` apenas em `offline`.
 * Assim, banners antigos não disparam por "falsa negativa" durante o boot
 * ou em uma única falha pontual de probe.
 */

const PROBE_INTERVAL_MS = 30_000;
const PROBE_TIMEOUT_MS = 4_000;
const FAIL_THRESHOLD = 2;

export type NetworkStatus = "checking" | "online" | "unstable" | "offline";

function getProbeUrl(): string {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (base && base.length > 0) {
    return `${base.replace(/\/$/, "")}/auth/v1/health`;
  }
  return "https://1.1.1.1/cdn-cgi/trace";
}

async function probeOnce(): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(getProbeUrl(), {
      method: "GET",
      cache: "no-store",
      signal: ctrl.signal,
      mode: "no-cors",
    });
    clearTimeout(timer);
    return res.type === "opaque" || res.ok;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

function logStatus(s: NetworkStatus) {
  if (!import.meta.env.DEV) return;
  // eslint-disable-next-line no-console
  console.debug(`[NETWORK_STATUS] ${s}`);
}

export interface NetworkStatusResult {
  /** Status detalhado para UI granular (ponto verde/amarelo/vermelho). */
  status: NetworkStatus;
  /**
   * Compat: `true` enquanto não houver offline confirmado.
   * Falsos-negativos (probe que falhou 1x) NÃO derrubam esse flag.
   */
  online: boolean;
  /** Última verificação (ms epoch). */
  lastCheckedAt: number | null;
}

export function useNetworkStatus(): NetworkStatusResult {
  const [status, setStatus] = useState<NetworkStatus>(() => {
    if (typeof navigator === "undefined") return "online";
    return navigator.onLine === false ? "offline" : "checking";
  });
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let failStreak = 0;

    const apply = (next: NetworkStatus) => {
      if (cancelled) return;
      setLastCheckedAt(Date.now());
      setStatus((prev) => {
        if (prev !== next) logStatus(next);
        return next;
      });
    };

    const recheck = async () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        failStreak = FAIL_THRESHOLD;
        apply("offline");
        return;
      }
      logStatus("checking");
      const ok = await probeOnce();
      if (cancelled) return;
      if (ok) {
        failStreak = 0;
        apply("online");
        return;
      }
      failStreak += 1;
      if (failStreak >= FAIL_THRESHOLD) {
        apply("offline");
      } else {
        apply("unstable");
      }
    };

    const goOnline = () => {
      // navigator diz que voltou — confirma com probe, não assume cego.
      failStreak = 0;
      void recheck();
    };
    const goOffline = () => {
      failStreak = FAIL_THRESHOLD;
      apply("offline");
    };
    const onFocus = () => {
      void recheck();
    };

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    window.addEventListener("focus", onFocus);

    void recheck();
    timer = setInterval(() => void recheck(), PROBE_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return {
    status,
    online: status !== "offline",
    lastCheckedAt,
  };
}
