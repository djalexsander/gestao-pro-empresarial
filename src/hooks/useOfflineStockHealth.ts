/**
 * useOfflineStockHealth — Etapa 5 (continuação)
 *
 * Polling leve do endpoint /api/estoque/saude do servidor local. Não roda
 * fora do desktop. Faz refresh a cada 30s e expõe acionador de rebuild.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  rebuildEstoqueLocal,
  verificarSaudeEstoque,
  type RebuildStockResult,
  type StockHealthReport,
} from "@/integrations/desktop/serverConnection";
import type { TerminalConexaoConfig } from "@/integrations/desktop/types";

const POLL_MS = 30_000;

export function useOfflineStockHealth(cfg?: TerminalConexaoConfig) {
  const [health, setHealth] = useState<StockHealthReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRebuild, setLastRebuild] =
    useState<RebuildStockResult | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (!cfg?.host || !cfg?.porta) {
      setHealth(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await verificarSaudeEstoque(cfg);
      if (!mounted.current) return;
      if (!r) setError("Servidor local indisponível.");
      setHealth(r);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [cfg]);

  const rebuild = useCallback(async () => {
    if (!cfg?.host || !cfg?.porta) return null;
    setRebuilding(true);
    setError(null);
    try {
      const r = await rebuildEstoqueLocal(cfg);
      if (!mounted.current) return r;
      if (!r) setError("Falha ao recalcular saldos.");
      else setLastRebuild(r);
      await refresh();
      return r;
    } finally {
      if (mounted.current) setRebuilding(false);
    }
  }, [cfg, refresh]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [refresh]);

  return { health, loading, rebuilding, error, lastRebuild, refresh, rebuild };
}
