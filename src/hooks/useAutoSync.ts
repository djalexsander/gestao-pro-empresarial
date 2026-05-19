/**
 * useAutoSync — orquestrador de sincronização automática em background.
 *
 * Gatilhos:
 *  - Boot (montagem inicial)
 *  - Entrada no ERP (transição de path PDV → ERP)
 *  - Reconexão de internet
 *  - Periódico (7 min)
 *
 * Faz backoff exponencial em erro (60s → 120s → 240s → 480s máx).
 * Estado é um singleton observável para alimentar `SyncStatusPill` sem prop-drilling.
 *
 * Só roda quando há `TerminalConexaoConfig` resolvida (modo terminal/server desktop).
 * Em web/cloud puro fica em no-op.
 */

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useLocation } from "@tanstack/react-router";
import { useDesktopRole } from "@/components/desktop/DesktopRoleProvider";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { sincronizarTudoAgora } from "@/integrations/desktop/serverConnection";
import { DEFAULT_LOCAL_PORT } from "@/components/desktop/useLocalServerBoot";
import type { TerminalConexaoConfig } from "@/integrations/desktop/types";

export type AutoSyncStatus = "idle" | "syncing" | "ok" | "error";

interface AutoSyncState {
  status: AutoSyncStatus;
  lastSyncAt: number | null;
  lastError: string | null;
  pending: number;
  okDomains: number;
  failedDomains: number;
}

const state: AutoSyncState = {
  status: "idle",
  lastSyncAt: null,
  lastError: null,
  pending: 0,
  okDomains: 0,
  failedDomains: 0,
};

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

let inFlight: Promise<void> | null = null;
let backoffMs = 60_000;
const BACKOFF_MIN = 60_000;
const BACKOFF_MAX = 480_000;
const PERIODIC_MS = 7 * 60_000;

async function runSync(cfg: TerminalConexaoConfig, motivo: string) {
  if (inFlight) return inFlight;
  state.status = "syncing";
  emit();
  console.log(`[AUTO_SYNC] iniciado ${motivo}`);
  inFlight = (async () => {
    try {
      const r = await sincronizarTudoAgora(cfg);
      state.okDomains = r.ok;
      state.failedDomains = r.failed;
      state.lastSyncAt = Date.now();
      if (r.failed === 0) {
        state.status = "ok";
        state.lastError = null;
        backoffMs = BACKOFF_MIN;
        console.log(`[AUTO_SYNC] concluído ok=${r.ok} failed=${r.failed}`);
      } else {
        state.status = "error";
        state.lastError = `${r.failed} domínio(s) falharam`;
        backoffMs = Math.min(BACKOFF_MAX, backoffMs * 2);
        console.warn(
          `[AUTO_SYNC] erro parcial ok=${r.ok} failed=${r.failed} — próximo retry em ${Math.round(backoffMs / 1000)}s`,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      state.status = "error";
      state.lastError = msg;
      backoffMs = Math.min(BACKOFF_MAX, backoffMs * 2);
      console.warn(
        `[AUTO_SYNC] erro: ${msg} — próximo retry em ${Math.round(backoffMs / 1000)}s`,
      );
    } finally {
      emit();
      inFlight = null;
    }
  })();
  return inFlight;
}

function resolveCfg(
  role: string,
  cfgTerminal: TerminalConexaoConfig | undefined,
): TerminalConexaoConfig | null {
  if (role === "terminal" && cfgTerminal?.host) return cfgTerminal;
  if (role === "server") {
    return {
      host: "127.0.0.1",
      porta: cfgTerminal?.porta ?? DEFAULT_LOCAL_PORT,
      terminalId: "local-server",
      terminalNome: "Servidor local",
    };
  }
  return null;
}

const PDV_PATHS = new Set(["/pos", "/pdv", "/auth", "/hub"]);
function isErpPath(p: string): boolean {
  return !PDV_PATHS.has(p);
}

/**
 * Monte UMA vez no nível do AppLayout. Múltiplas montagens são seguras
 * (inFlight guard), mas desnecessárias.
 */
export function useAutoSync(): void {
  const { isDesktop: desk, role, config } = useDesktopRole();
  const { online } = useNetworkStatus();
  const location = useLocation();

  const cfg = desk ? resolveCfg(role, config.terminal) : null;
  const cfgKey = cfg ? `${cfg.host}:${cfg.porta}` : "";

  const bootedRef = useRef(false);
  const prevOnlineRef = useRef(online);
  const wasErpRef = useRef(false);
  const lastTriggerRef = useRef(0);

  // Boot
  useEffect(() => {
    if (!cfg) return;
    if (bootedRef.current) return;
    bootedRef.current = true;
    lastTriggerRef.current = Date.now();
    void runSync(cfg, "ao abrir app");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfgKey]);

  // Entrada no ERP
  useEffect(() => {
    if (!cfg) return;
    const inErp = isErpPath(location.pathname);
    const wasErp = wasErpRef.current;
    wasErpRef.current = inErp;
    if (!wasErp && inErp && bootedRef.current) {
      // throttle: pelo menos 30s desde último trigger
      if (Date.now() - lastTriggerRef.current > 30_000) {
        lastTriggerRef.current = Date.now();
        void runSync(cfg, "ao entrar ERP");
      }
    }
  }, [location.pathname, cfg, cfgKey]);

  // Reconexão
  useEffect(() => {
    if (!cfg) return;
    const wasOnline = prevOnlineRef.current;
    prevOnlineRef.current = online;
    if (!wasOnline && online) {
      lastTriggerRef.current = Date.now();
      void runSync(cfg, "ao reconectar");
    }
  }, [online, cfg, cfgKey]);

  // Periódico
  useEffect(() => {
    if (!cfg) return;
    const t = setInterval(() => {
      if (!online) return;
      // respeita backoff em caso de erro recente
      const sinceLast = Date.now() - (state.lastSyncAt ?? 0);
      const minWait = state.status === "error" ? backoffMs : PERIODIC_MS;
      if (sinceLast < minWait) return;
      lastTriggerRef.current = Date.now();
      void runSync(cfg, "periódico");
    }, 60_000);
    return () => clearInterval(t);
  }, [cfgKey, online, cfg]);
}

/** Snapshot reativo do estado, para componentes de UI (pill). */
export function useAutoSyncState(): AutoSyncState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

/** Trigger manual (botão Sincronizar agora externo, se quiser reaproveitar). */
export function triggerAutoSync(cfg: TerminalConexaoConfig): Promise<void> {
  return runSync(cfg, "manual");
}
