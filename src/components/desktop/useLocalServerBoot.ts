import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useDesktopRole } from "./DesktopRoleProvider";
import {
  isLocalServerStartInProgress,
  startLocalServer,
  stopLocalServer,
  type LocalServerStatus,
} from "@/integrations/desktop/tauriBridge";
import { isDesktop } from "@/integrations/data/mode";
import {
  clearLocalServerAuth,
  registerLocalServerAuth,
} from "@/integrations/desktop/serverConnection";
import {
  getDesktopConfig,
  setDesktopConfig,
} from "@/integrations/desktop/configStore";

export const DEFAULT_LOCAL_PORT = 3333;
const WATCHDOG_MS = 15_000;
const WATCHDOG_RESTART_THRESHOLD = 3;
const RECOVERY_BACKOFF_MS = [5_000, 15_000, 30_000, 60_000] as const;

export type LocalServerHealth =
  | "active"
  | "unstable"
  | "reconnecting"
  | "unavailable";

export interface BootState {
  starting: boolean;
  action: "start" | "restart" | null;
  lastError: string | null;
  lastStatus: LocalServerStatus | null;
  health: LocalServerHealth;
  healthFailCount: number;
  start: () => Promise<LocalServerStatus | null>;
  restart: () => Promise<LocalServerStatus | null>;
}

const STATE: BootState & { listeners: Set<() => void> } = {
  starting: false,
  action: null,
  lastError: null,
  lastStatus: null,
  health: "unavailable",
  healthFailCount: 0,
  start: async () => null,
  restart: async () => null,
  listeners: new Set(),
};

let recoveryInFlight: Promise<boolean> | null = null;
let recoveryAttempt = 0;
let nextRecoveryAt = 0;
let recoveryTimer: ReturnType<typeof setTimeout> | null = null;

function resetRecoveryBackoff() {
  recoveryAttempt = 0;
  nextRecoveryAt = 0;
  if (recoveryTimer) {
    clearTimeout(recoveryTimer);
    recoveryTimer = null;
  }
}

function notify() {
  STATE.listeners.forEach((listener) => listener());
}

function friendlyStartError(error: unknown): string {
  const message = String(error);
  const lower = message.toLowerCase();
  if (
    lower.includes("address already in use") ||
    lower.includes("os error 10048") ||
    lower.includes("ocupada por outro processo") ||
    (lower.includes("porta") && lower.includes("uso"))
  ) {
    return "Porta 3333 ocupada por outro processo.";
  }
  return message;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connectionOptions() {
  const config = getDesktopConfig();
  const port = config.serverPort ?? config.terminal?.porta ?? DEFAULT_LOCAL_PORT;
  const terminalHost = config.terminal?.host
    ?.replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const baseUrl =
    config.role === "terminal" && terminalHost
      ? `http://${terminalHost}:${config.terminal?.porta ?? port}`
      : config.localBaseUrl ?? `http://127.0.0.1:${port}`;
  return { config, port, baseUrl };
}

async function healthOk(baseUrl: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2_500);
  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { status?: string; app?: string };
    return payload.status === "ok" && payload.app === "Gestao Pro";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function doStart(
  opts: {
    port: number;
    serverName: string | null;
    serverId: string | null;
    authToken: string | null;
    allowWhileStarting?: boolean;
    silent?: boolean;
  },
  action: "start" | "restart" = "start",
): Promise<LocalServerStatus | null> {
  if (!isDesktop()) return null;
  if (STATE.starting && !opts.allowWhileStarting) return STATE.lastStatus;
  if (isLocalServerStartInProgress()) {
    console.warn("[START REJECTED_ALREADY_RUNNING]", { port: opts.port });
    return STATE.lastStatus;
  }

  STATE.starting = true;
  STATE.action = action;
  STATE.lastError = null;
  notify();

  try {
    const status = await startLocalServer({
      port: opts.port,
      serverName: opts.serverName,
      serverId: opts.serverId,
      upstreamUrl:
        (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? null,
      upstreamAnonKey:
        (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
        null,
      authToken: opts.authToken,
    });
    STATE.lastStatus = status;

    const actualPort = status.port ?? opts.port;
    const baseUrl = `http://127.0.0.1:${actualPort}`;
    if (status.auth_token) {
      registerLocalServerAuth(baseUrl, status.auth_token);
    }

    const current = getDesktopConfig();
    setDesktopConfig({
      ...current,
      serverPort: actualPort,
      localBaseUrl: baseUrl,
      serverId: current.serverId ?? status.server_id ?? opts.serverId ?? undefined,
      serverNome:
        current.serverNome ?? status.server_name ?? opts.serverName ?? undefined,
      serverAuthToken: current.serverAuthToken ?? status.auth_token ?? undefined,
    });

    if (!status.running) {
      STATE.health = "unavailable";
      STATE.lastError = "O backend local nao confirmou execucao.";
      if (!opts.silent) toast.error(STATE.lastError);
      return status;
    }

    STATE.health = "active";
    STATE.healthFailCount = 0;
    if (!opts.silent) {
      toast.success(`Backend local iniciado na porta ${actualPort}.`);
    }
    return status;
  } catch (error) {
    STATE.health = "unavailable";
    STATE.lastError = friendlyStartError(error);
    console.error("[local-server-watchdog] start_local_server falhou", error);
    if (!opts.silent) {
      toast.error(`Nao foi possivel iniciar o backend local: ${STATE.lastError}`);
    }
    return null;
  } finally {
    STATE.starting = false;
    STATE.action = null;
    notify();
  }
}

export async function ensureLocalServerReady(
  options: { force?: boolean } = { force: true },
): Promise<boolean> {
  if (recoveryInFlight) return recoveryInFlight;
  if (!options.force && Date.now() < nextRecoveryAt) return false;
  recoveryInFlight = (async () => {
    const { config, port, baseUrl } = connectionOptions();
    if (STATE.starting) {
      await delay(1_000);
    }
    if (await healthOk(baseUrl)) {
      STATE.health = "active";
      STATE.healthFailCount = 0;
      STATE.lastError = null;
      resetRecoveryBackoff();
      notify();
      return true;
    }

    STATE.health = "reconnecting";
    notify();
    console.warn("[local-server-watchdog] auto-restart iniciado", {
      role: config.role,
      port,
      baseUrl,
    });

    if (config.role === "server") {
      const status = await doStart(
        {
          port,
          serverName:
            config.serverNome ??
            config.terminal?.terminalNome ??
            "Servidor Gestao Pro",
          serverId: config.serverId ?? null,
          authToken: config.serverAuthToken ?? null,
          silent: true,
        },
        "restart",
      );
      if (status?.running && (await healthOk(baseUrl))) {
        STATE.health = "active";
        STATE.healthFailCount = 0;
        STATE.lastError = null;
        resetRecoveryBackoff();
        console.info("[local-server-watchdog] auto-restart sucesso", { port });
        notify();
        return true;
      }
    } else if (config.role === "terminal") {
      await delay(750);
      if (await healthOk(baseUrl)) {
        STATE.health = "active";
        STATE.healthFailCount = 0;
        STATE.lastError = null;
        resetRecoveryBackoff();
        console.info("[local-server-watchdog] reconexao terminal sucesso", {
          baseUrl,
        });
        notify();
        return true;
      }
    }

    STATE.health = "unavailable";
    STATE.lastError =
      "Servidor local indisponivel. Tentamos reconectar automaticamente, mas nao foi possivel.";
    const backoff =
      RECOVERY_BACKOFF_MS[
        Math.min(recoveryAttempt, RECOVERY_BACKOFF_MS.length - 1)
      ];
    recoveryAttempt += 1;
    nextRecoveryAt = Date.now() + backoff;
    if (recoveryTimer) clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      void ensureLocalServerReady({ force: false });
    }, backoff);
    console.error("[local-server-watchdog] auto-restart falha", {
      role: config.role,
      port,
      baseUrl,
      retryInMs: backoff,
    });
    notify();
    return false;
  })().finally(() => {
    recoveryInFlight = null;
  });
  return recoveryInFlight;
}

export function useLocalServerBoot() {
  const { isDesktop: desktop, role, config } = useDesktopRole();
  const startedRef = useRef(false);
  const previousRole = useRef(role);

  useEffect(() => {
    if (!desktop) return;
    if (role === "server" && config.serverAuthToken) {
      const port = config.serverPort ?? DEFAULT_LOCAL_PORT;
      registerLocalServerAuth(
        `http://127.0.0.1:${port}`,
        config.serverAuthToken,
      );
    } else if (role === "terminal" && config.terminal?.serverToken) {
      const host = config.terminal.host
        .replace(/^https?:\/\//, "")
        .replace(/\/+$/, "");
      registerLocalServerAuth(
        `http://${host}:${config.terminal.porta}`,
        config.terminal.serverToken,
      );
    }
  }, [
    desktop,
    role,
    config.serverAuthToken,
    config.serverPort,
    config.terminal,
  ]);

  useEffect(() => {
    if (!desktop) return;

    if (role === "server" && !startedRef.current) {
      startedRef.current = true;
      void doStart({
        port: config.serverPort ?? DEFAULT_LOCAL_PORT,
        serverName:
          config.serverNome ??
          config.terminal?.terminalNome ??
          "Servidor Gestao Pro",
        serverId: config.serverId ?? null,
        authToken: config.serverAuthToken ?? null,
        silent: true,
      });
    }

    if (previousRole.current === "server" && role !== "server") {
      resetRecoveryBackoff();
      console.warn("[local-server-watchdog] stop por mudanca de papel", {
        from: previousRole.current,
        to: role,
      });
      void stopLocalServer("desktop-role-change").catch((error) => {
        console.error("[local-server-watchdog] stop por papel falhou", error);
      });
      clearLocalServerAuth();
      startedRef.current = false;
    }
    previousRole.current = role;
  }, [
    desktop,
    role,
    config.serverPort,
    config.serverNome,
    config.serverId,
    config.serverAuthToken,
    config.terminal?.terminalNome,
  ]);

  useEffect(() => {
    if (!desktop || role !== "server") return;
    let cancelled = false;
    let checkInFlight = false;

    const check = async () => {
      if (checkInFlight) return;
      checkInFlight = true;
      try {
        const { baseUrl } = connectionOptions();
        const ok = await healthOk(baseUrl);
        if (cancelled) return;

        if (ok) {
          if (STATE.healthFailCount > 0) {
            console.info("[local-server-watchdog] health recuperado", {
              previousFailures: STATE.healthFailCount,
              baseUrl,
            });
          }
          STATE.healthFailCount = 0;
          STATE.health = "active";
          STATE.lastError = null;
          resetRecoveryBackoff();
          notify();
          return;
        }

        STATE.healthFailCount += 1;
        STATE.health =
          STATE.healthFailCount >= WATCHDOG_RESTART_THRESHOLD
            ? "reconnecting"
            : "unstable";
        console.warn("[local-server-watchdog] health fail", {
          count: STATE.healthFailCount,
          baseUrl,
        });
        notify();

        if (STATE.healthFailCount >= WATCHDOG_RESTART_THRESHOLD) {
          await ensureLocalServerReady({ force: false });
        }
      } finally {
        checkInFlight = false;
      }
    };

    void check();
    const timer = setInterval(() => void check(), WATCHDOG_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [desktop, role]);
}

export function useBootController(): BootState {
  const { config } = useDesktopRole();
  const [, forceRender] = useState(0);

  useEffect(() => {
    const listener = () => forceRender((value) => value + 1);
    STATE.listeners.add(listener);
    return () => {
      STATE.listeners.delete(listener);
    };
  }, []);

  const start = useCallback(
    () =>
      doStart({
        port: config.serverPort ?? DEFAULT_LOCAL_PORT,
        serverName:
          config.serverNome ??
          config.terminal?.terminalNome ??
          "Servidor Gestao Pro",
        serverId: config.serverId ?? null,
        authToken: config.serverAuthToken ?? null,
      }),
    [config],
  );

  const restart = useCallback(async () => {
    STATE.starting = true;
    STATE.action = "restart";
    STATE.lastError = null;
    notify();
    try {
      console.warn("[local-server-watchdog] restart manual iniciado", {
        port: config.serverPort ?? DEFAULT_LOCAL_PORT,
      });
      await stopLocalServer("manual-restart");
      await delay(1_000);
      resetRecoveryBackoff();
      return await doStart(
        {
          port: config.serverPort ?? DEFAULT_LOCAL_PORT,
          serverName:
            config.serverNome ??
            config.terminal?.terminalNome ??
            "Servidor Gestao Pro",
          serverId: config.serverId ?? null,
          authToken: config.serverAuthToken ?? null,
          allowWhileStarting: true,
        },
        "restart",
      );
    } finally {
      STATE.starting = false;
      STATE.action = null;
      notify();
    }
  }, [config]);

  return {
    starting: STATE.starting,
    action: STATE.action,
    lastError: STATE.lastError,
    lastStatus: STATE.lastStatus,
    health: STATE.health,
    healthFailCount: STATE.healthFailCount,
    start,
    restart,
  };
}
