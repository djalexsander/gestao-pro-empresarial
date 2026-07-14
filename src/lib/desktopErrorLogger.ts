const FALLBACK_KEY = "gp.diagnostic.errors.v1";
const SEEN_VERSIONS_KEY = "gp.diagnostic.seenVersions.v1";
const FALLBACK_LIMIT = 100;
const DEDUPE_WINDOW_MS = 1_500;

export type DiagnosticType =
  | "application-start"
  | "boot-step"
  | "window-error"
  | "unhandled-rejection"
  | "react-error-boundary"
  | "router-error-boundary"
  | "diagnostic";

export interface DiagnosticErrorInput {
  type: DiagnosticType | string;
  error?: unknown;
  componentStack?: string | null;
  additional?: Record<string, unknown>;
}

type NativeContext = { pid: number; logPath: string };

type DiagnosticRecord = {
  bootSessionId: string;
  timestamp: string;
  type: string;
  error: { name: string; message: string; stack: string | null } | null;
  componentStack: string | null;
  location: {
    href: string | null;
    pathname: string | null;
    search: string | null;
    hash: string | null;
  };
  documentReadyState: DocumentReadyState | null;
  userAgent: string | null;
  appVersion: string | null;
  isTauri: boolean;
  pid: number | null;
  localStorageKeys: string[];
  sessionStorageKeys: string[];
  lastBootStep: string;
  firstRunOfVersionInProfile: boolean | null;
  additional: unknown;
};

declare global {
  interface Window {
    __GESTAO_PRO_DIAGNOSTICS_INSTALLED__?: boolean;
  }
}

function makeBootSessionId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `boot-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export const BOOT_SESSION_ID = makeBootSessionId();
let lastBootStep = "bootstrap-script-started";
let writeQueue: Promise<void> = Promise.resolve();
let nativeContextPromise: Promise<NativeContext | null> | null = null;
let versionPromise: Promise<string | null> | null = null;
const recentFingerprints = new Map<string, number>();
const recordedBootSteps = new Set<string>();

export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const runtime = window as unknown as Record<string, unknown>;
  return Boolean(runtime.__TAURI_INTERNALS__) || Boolean(runtime.__TAURI__);
}

function storageKeyNames(storage: Storage | undefined): string[] {
  if (!storage) return [];
  try {
    return Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key): key is string => Boolean(key))
      .map((key) =>
        /password|passwd|secret|cookie|credential/i.test(key) ? "[sensitive-key]" : key,
      )
      .sort();
  } catch {
    return [];
  }
}

function normalizeError(value: unknown): DiagnosticRecord["error"] {
  if (value == null) return null;
  if (value instanceof Error) {
    return { name: value.name || "Error", message: value.message, stack: value.stack ?? null };
  }
  if (typeof value === "object") {
    const candidate = value as { name?: unknown; message?: unknown; stack?: unknown };
    return {
      name: typeof candidate.name === "string" ? candidate.name : "NonErrorRejection",
      message: typeof candidate.message === "string" ? candidate.message : safelyStringify(value),
      stack: typeof candidate.stack === "string" ? candidate.stack : null,
    };
  }
  return { name: "NonErrorRejection", message: String(value), stack: null };
}

function sanitize(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.length > 4_000 ? `${value.slice(0, 4_000)}…` : value;
  if (typeof value !== "object") return String(value);
  if (depth >= 4) return "[max-depth]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value))
    return value.slice(0, 50).map((item) => sanitize(item, depth + 1, seen));
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value).slice(0, 50)) {
    output[key] = /token|password|passwd|secret|cookie|authorization|financial|financeiro/i.test(
      key,
    )
      ? "[redacted]"
      : sanitize(child, depth + 1, seen);
  }
  return output;
}

function safelyStringify(value: unknown): string {
  try {
    return JSON.stringify(sanitize(value));
  } catch {
    return String(value);
  }
}

async function getVersion(): Promise<string | null> {
  if (versionPromise) return versionPromise;
  versionPromise = (async () => {
    if (!isTauriRuntime()) return null;
    try {
      const { getVersion: getTauriVersion } = await import("@tauri-apps/api/app");
      return await getTauriVersion();
    } catch {
      return null;
    }
  })();
  return versionPromise;
}

async function getNativeContext(): Promise<NativeContext | null> {
  if (nativeContextPromise) return nativeContextPromise;
  nativeContextPromise = (async () => {
    if (!isTauriRuntime()) return null;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<NativeContext>("diagnostic_context");
    } catch {
      return null;
    }
  })();
  return nativeContextPromise;
}

function detectFirstRun(version: string | null): boolean | null {
  if (!version || typeof localStorage === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(SEEN_VERSIONS_KEY) ?? "[]");
    const seen = Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
    const firstRun = !seen.includes(version);
    if (firstRun)
      localStorage.setItem(SEEN_VERSIONS_KEY, JSON.stringify([...seen.slice(-19), version]));
    return firstRun;
  } catch {
    return null;
  }
}

function saveFallback(record: DiagnosticRecord) {
  try {
    const parsed = JSON.parse(localStorage.getItem(FALLBACK_KEY) ?? "[]");
    const records = Array.isArray(parsed) ? parsed : [];
    localStorage.setItem(FALLBACK_KEY, JSON.stringify([...records, record].slice(-FALLBACK_LIMIT)));
  } catch {
    // Logging must never break application startup.
  }
}

async function persistRecord(record: DiagnosticRecord): Promise<void> {
  if (record.error) console.error(`[diagnostic:${record.type}]`, record);
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke<string>("append_diagnostic_log", { entry: JSON.stringify(record) });
      return;
    } catch (fileError) {
      console.error("[diagnostic:file-fallback]", fileError);
    }
  }
  saveFallback(record);
}

function isDuplicate(type: string, error: DiagnosticRecord["error"]): boolean {
  if (!error) return false;
  const now = Date.now();
  const fingerprint = `${type}|${error.name}|${error.message}|${error.stack ?? ""}`;
  const previous = recentFingerprints.get(fingerprint) ?? 0;
  recentFingerprints.set(fingerprint, now);
  for (const [key, timestamp] of recentFingerprints) {
    if (now - timestamp > 10_000) recentFingerprints.delete(key);
  }
  return now - previous < DEDUPE_WINDOW_MS;
}

export function markBootStep(step: string, additional?: Record<string, unknown>) {
  lastBootStep = step;
  if (recordedBootSteps.has(step)) return;
  recordedBootSteps.add(step);
  void logDiagnostic({ type: "boot-step", additional: { step, ...additional } });
}

export function getLastBootStep(): string {
  return lastBootStep;
}

export function logDiagnostic(input: DiagnosticErrorInput): Promise<void> {
  const bootStepAtCall = lastBootStep;
  const task = async () => {
    try {
      const error = normalizeError(input.error);
      if (isDuplicate(input.type, error)) return;
      const [appVersion, nativeContext] = await Promise.all([getVersion(), getNativeContext()]);
      const record: DiagnosticRecord = {
        bootSessionId: BOOT_SESSION_ID,
        timestamp: new Date().toISOString(),
        type: input.type,
        error,
        componentStack: input.componentStack ?? null,
        location: {
          href: typeof window !== "undefined" ? window.location.href : null,
          pathname: typeof window !== "undefined" ? window.location.pathname : null,
          search: typeof window !== "undefined" ? window.location.search : null,
          hash: typeof window !== "undefined" ? window.location.hash : null,
        },
        documentReadyState: typeof document !== "undefined" ? document.readyState : null,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        appVersion,
        isTauri: isTauriRuntime(),
        pid: nativeContext?.pid ?? null,
        localStorageKeys: typeof window !== "undefined" ? storageKeyNames(window.localStorage) : [],
        sessionStorageKeys:
          typeof window !== "undefined" ? storageKeyNames(window.sessionStorage) : [],
        lastBootStep: bootStepAtCall,
        firstRunOfVersionInProfile:
          input.type === "application-start" ? detectFirstRun(appVersion) : null,
        additional: sanitize(input.additional ?? null),
      };
      await persistRecord(record);
    } catch (loggerError) {
      console.error("[diagnostic:logger-failure]", loggerError);
    }
  };
  writeQueue = writeQueue.then(task, task);
  return writeQueue;
}

export async function getDiagnosticLogPath(): Promise<string | null> {
  return (await getNativeContext())?.logPath ?? null;
}

export async function readDiagnosticLog(): Promise<string> {
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<string>("read_diagnostic_log");
    } catch (readError) {
      console.error("[diagnostic:read-file-fallback]", readError);
    }
  }
  try {
    return localStorage.getItem(FALLBACK_KEY) ?? "[]";
  } catch {
    return "";
  }
}

function installGlobalErrorHandlers() {
  if (typeof window === "undefined" || window.__GESTAO_PRO_DIAGNOSTICS_INSTALLED__) return;
  window.__GESTAO_PRO_DIAGNOSTICS_INSTALLED__ = true;
  window.addEventListener("error", (event) => {
    void logDiagnostic({
      type: "window-error",
      error: event.error ?? new Error(event.message || "Erro global sem mensagem"),
      additional: { filename: event.filename, lineno: event.lineno, colno: event.colno },
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    void logDiagnostic({ type: "unhandled-rejection", error: event.reason });
  });
}

installGlobalErrorHandlers();
void logDiagnostic({
  type: "application-start",
  additional: {
    startupReason: "application-bootstrap",
    initialUrl: typeof window !== "undefined" ? window.location.href : null,
  },
});
