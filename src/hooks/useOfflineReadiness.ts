/**
 * Hook de prontidão offline (Etapa 3).
 *
 * Consulta `/api/offline/status` no servidor local e expõe ação para rodar
 * `/api/offline/sync-inicial`. Não trava a UI: erros viram `error`, nunca
 * exceções não tratadas.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchOfflineStatus,
  runSyncInicial,
  type OfflineStatus,
  type OfflineSyncResult,
} from "@/integrations/desktop/serverConnection";
import type { TerminalConexaoConfig } from "@/integrations/desktop/types";
import { supabase } from "@/integrations/supabase/client";

export interface UseOfflineReadinessResult {
  status: OfflineStatus | null;
  loading: boolean;
  syncing: boolean;
  error: string | null;
  lastSync: OfflineSyncResult | null;
  refresh: () => Promise<void>;
  sincronizar: () => Promise<void>;
}

async function getAuthToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export function useOfflineReadiness(
  cfg?: TerminalConexaoConfig,
): UseOfflineReadinessResult {
  const [status, setStatus] = useState<OfflineStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<OfflineSyncResult | null>(null);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!cfg) return;
    setLoading(true);
    try {
      const token = await getAuthToken();
      const s = await fetchOfflineStatus(cfg, token);
      if (!aliveRef.current) return;
      setStatus(s);
      setError(s ? null : "Não foi possível consultar o status offline.");
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [cfg]);

  const sincronizar = useCallback(async () => {
    if (!cfg) return;
    if (import.meta.env.DEV) console.info("[OFFLINE_SYNC] início (frontend)");
    setSyncing(true);
    setError(null);
    try {
      const token = await getAuthToken();
      if (!token) {
        const msg =
          "Sessão não autenticada. Faça login com internet e tente novamente.";
        setError(msg);
        if (import.meta.env.DEV) console.error("[OFFLINE_SYNC] sem token");
        return;
      }
      const r = await runSyncInicial(cfg, token);
      if (!aliveRef.current) return;
      if ("error" in r && !("results" in r)) {
        setError(r.error);
        if (import.meta.env.DEV) console.error("[OFFLINE_SYNC] erro:", r.error);
      } else {
        const result = r as OfflineSyncResult;
        setLastSync(result);
        if (import.meta.env.DEV) {
          for (const d of result.results) {
            console.info(
              `[OFFLINE_SYNC] ${d.domain} recebidos=${d.delta} total=${d.row_count} ok=${d.ok}${d.error ? ` erro=${d.error}` : ""}`,
            );
          }
          console.info(
            `[OFFLINE_SYNC] persistidos=${result.total_delta} ok=${result.ok}`,
          );
          if (result.ok && result.total_delta === 0) {
            console.warn(
              "[OFFLINE_SYNC] commit sem novos registros — verifique se o usuário tem empresa vinculada / RLS",
            );
          } else if (result.ok) {
            console.info("[OFFLINE_SYNC] commit realizado");
          }
        }
        if (!result.ok) {
          const falhas = result.results
            .filter((d) => !d.ok)
            .map((d) => `${d.label}: ${d.error ?? "erro"}`)
            .join(" • ");
          setError(
            falhas ||
              "Alguns domínios não foram sincronizados. Verifique a conexão.",
          );
        } else {
          const totalRows = result.results.reduce(
            (acc, d) => acc + d.row_count,
            0,
          );
          if (totalRows === 0) {
            setError(
              "Sincronização executou, mas nenhum dado foi materializado. " +
                "Verifique se o usuário tem empresa vinculada e tente novamente.",
            );
          }
        }
      }
      await refresh();
    } finally {
      if (aliveRef.current) setSyncing(false);
    }
  }, [cfg, refresh]);

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    const t = setInterval(() => void refresh(), 30_000);
    return () => {
      aliveRef.current = false;
      clearInterval(t);
    };
  }, [refresh]);

  return { status, loading, syncing, error, lastSync, refresh, sincronizar };
}
