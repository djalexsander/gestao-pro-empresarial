import { useEffect, useState } from "react";

/**
 * Hook leve pra monitorar conexão com a internet.
 *
 * - Usa `navigator.onLine` como sinal primário (instantâneo).
 * - Reage aos eventos `online` / `offline` do browser.
 * - Não faz polling ativo pra não gastar bateria/rede; o sinal é refinado
 *   por componentes que quiserem (ex.: bater no Supabase com timeout curto).
 */
export function useNetworkStatus(): { online: boolean } {
  const [online, setOnline] = useState<boolean>(() => {
    if (typeof navigator === "undefined") return true;
    return navigator.onLine;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return { online };
}
