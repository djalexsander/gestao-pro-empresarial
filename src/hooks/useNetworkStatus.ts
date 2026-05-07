import { useEffect, useState } from "react";

/**
 * Hook pra monitorar conexão real com a internet.
 *
 * Estratégia:
 *  - Sinal primário: `navigator.onLine` + eventos `online` / `offline`
 *    do browser (instantâneo, mas notoriamente otimista — pode reportar
 *    "online" quando só há rede local sem saída pra internet, e em
 *    alguns ambientes embarcados pode ficar "offline" sem motivo).
 *  - Por isso confirmamos com um probe HEAD leve contra um endpoint
 *    público estável (Supabase REST). Só marcamos `online: false` quando
 *    o probe falhar — assim evitamos o falso "sem internet" do print do
 *    usuário, que aparecia mesmo com conexão.
 *  - O probe roda no boot, sempre que o evento `online` dispara, ao
 *    voltar foco da janela e a cada 30s em background.
 */

const PROBE_INTERVAL_MS = 30_000;
const PROBE_TIMEOUT_MS = 4_000;

function getProbeUrl(): string {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (base && base.length > 0) {
    // /auth/v1/health responde 200 sem auth e é barato (poucos bytes).
    return `${base.replace(/\/$/, "")}/auth/v1/health`;
  }
  // Fallback: Cloudflare trace (texto curto, suporta CORS).
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
      // `no-cors` garante que mesmo respostas opacas (sem CORS aberto)
      // contem como "rede ok" — só nos importa se a request completou.
      mode: "no-cors",
    });
    clearTimeout(timer);
    // Em modo no-cors, type === "opaque" e status === 0; isso ainda
    // significa que a rede chegou no host. Só falhamos se houver throw.
    return res.type === "opaque" || res.ok;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

export function useNetworkStatus(): { online: boolean } {
  const [online, setOnline] = useState<boolean>(() => {
    if (typeof navigator === "undefined") return true;
    return navigator.onLine;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const recheck = async () => {
      // Se o browser tem 100% de certeza que está offline, confia nele.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        if (!cancelled) setOnline(false);
        return;
      }
      const ok = await probeOnce();
      if (!cancelled) setOnline(ok);
    };

    const goOnline = () => {
      // Não setamos true cego — confirmamos com probe.
      recheck();
    };
    const goOffline = () => setOnline(false);
    const onFocus = () => recheck();

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    window.addEventListener("focus", onFocus);

    // Probe inicial e periódico.
    recheck();
    timer = setInterval(recheck, PROBE_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return { online };
}
