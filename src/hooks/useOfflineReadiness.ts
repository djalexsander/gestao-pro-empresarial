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

export interface UseOfflineReadinessResult {
  status: OfflineStatus | null;
  loading: boolean;
  syncing: boolean;
  error: string | null;
  lastSync: OfflineSyncResult | null;
  refresh: () => Promise<void>;
  sincronizar: () => Promise<void>;
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
      const s = await fetchOfflineStatus(cfg);
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
      const r = await runSyncInicial(cfg);
      if (!aliveRef.current) return;
      if ("error" in r && !("results" in r)) {
        setError(r.error);
        if (import.meta.env.DEV) console.error("[OFFLINE_SYNC] erro:", r.error);
      } else {
        setLastSync(r as OfflineSyncResult);
        if (import.meta.env.DEV)
          console.info("[OFFLINE_SYNC] concluído", r);
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
