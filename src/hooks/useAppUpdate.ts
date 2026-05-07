import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Hook unificado de atualização:
 * - **Desktop (Tauri)**: usa `@tauri-apps/plugin-updater` para checar/baixar/instalar
 *   atualizações assinadas configuradas em `tauri.conf.json`. Verifica ao abrir o
 *   app e a cada 30 minutos.
 * - **Web**: compara a assinatura dos assets do `index.html` (Vite gera hashes
 *   estáveis) e oferece "atualizar" como reload.
 *
 * Preferências persistidas em localStorage (chave `app-update:prefs`):
 *   - autoCheck: boolean (default true)
 *   - autoDownload: boolean (default false)
 *   - channel: "stable" | "beta" | "dev" (default "stable")
 */

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 min
const SNOOZE_MS = 30 * 60 * 1000;
const SNOOZE_KEY = "app-update:snoozed-until";
const PREFS_KEY = "app-update:prefs";

export type UpdateChannel = "stable" | "beta" | "dev";

export interface UpdatePrefs {
  autoCheck: boolean;
  autoDownload: boolean;
  channel: UpdateChannel;
}

const DEFAULT_PREFS: UpdatePrefs = {
  autoCheck: true,
  autoDownload: false,
  channel: "stable",
};

export function loadUpdatePrefs(): UpdatePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveUpdatePrefs(prefs: UpdatePrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

function isInTauri(): boolean {
  if (typeof window === "undefined") return false;
  // @ts-expect-error - injected by Tauri runtime
  return Boolean(window.__TAURI_INTERNALS__) || Boolean(window.__TAURI__);
}

/* ---------------- WEB: assinatura de assets ---------------- */

function extractAssetSignature(html: string): string | null {
  try {
    const scriptRegex =
      /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>|<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*\btype=["']module["'][^>]*>/gi;
    const linkRegex =
      /<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["'][^>]*>|<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']stylesheet["'][^>]*>/gi;

    const urls = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = scriptRegex.exec(html))) urls.add(m[1] ?? m[2]);
    while ((m = linkRegex.exec(html))) urls.add(m[1] ?? m[2]);

    const filtered = [...urls].filter((u) => {
      if (!u) return false;
      if (/^https?:\/\//i.test(u)) {
        try {
          const parsed = new URL(u, window.location.origin);
          return parsed.origin === window.location.origin;
        } catch {
          return false;
        }
      }
      return true;
    });

    if (filtered.length === 0) return null;
    return filtered.sort().join("|");
  } catch {
    return null;
  }
}

async function fetchAssetSignature(): Promise<string | null> {
  try {
    const res = await fetch(`/?_v=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Cache-Control": "no-cache" },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return extractAssetSignature(text);
  } catch {
    return null;
  }
}

/* ---------------- TIPOS ---------------- */

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "ready"
  | "error"
  | "offline";

export interface AppUpdateState {
  isTauri: boolean;
  online: boolean;
  status: UpdateStatus;
  updateAvailable: boolean;
  currentVersion: string | null;
  newVersion: string | null;
  releaseDate: string | null;
  releaseNotes: string | null;
  contentLength: number | null;
  downloaded: number;
  progress: number; // 0..100
  error: string | null;
  lastChecked: Date | null;
  isApplying: boolean;
  /** Verifica manualmente. */
  check: () => Promise<void>;
  /** Inicia download + instalação. */
  applyUpdate: () => Promise<void>;
  /** Reinicia o app (desktop). No web faz reload. */
  restart: () => Promise<void>;
  /** Adia notificação por 30 minutos. */
  snooze: () => void;
  /** Fecha banner (silencia até próximo check com nova versão). */
  dismiss: () => void;
}

/* ---------------- HOOK ---------------- */

export function useAppUpdate(): AppUpdateState {
  const tauri = useRef(isInTauri());
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [newVersion, setNewVersion] = useState<string | null>(null);
  const [releaseDate, setReleaseDate] = useState<string | null>(null);
  const [releaseNotes, setReleaseNotes] = useState<string | null>(null);
  const [contentLength, setContentLength] = useState<number | null>(null);
  const [downloaded, setDownloaded] = useState(0);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const dismissedRef = useRef(false);
  const initialSigRef = useRef<string | null>(null);
  const updateRef = useRef<unknown>(null);

  const isSnoozed = useCallback(() => {
    try {
      const until = Number(localStorage.getItem(SNOOZE_KEY) || "0");
      return until > Date.now();
    } catch {
      return false;
    }
  }, []);

  /* Carrega versão atual no desktop */
  useEffect(() => {
    if (!tauri.current) return;
    void (async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        setCurrentVersion(await getVersion());
      } catch {
        /* ignore */
      }
    })();
  }, []);

  /* Online/offline */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const checkTauri = useCallback(async () => {
    if (!tauri.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setStatus("offline");
      return;
    }
    setError(null);
    setStatus((s) => (s === "available" ? s : "checking"));
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      setLastChecked(new Date());
      if (update) {
        updateRef.current = update;
        setNewVersion(update.version);
        setReleaseDate(update.date ?? null);
        setReleaseNotes(update.body ?? null);
        if (!isSnoozed() && !dismissedRef.current) {
          setStatus("available");
        }
      } else {
        updateRef.current = null;
        setNewVersion(null);
        setStatus("idle");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStatus("error");
    }
  }, [isSnoozed]);

  const checkWeb = useCallback(async () => {
    if (tauri.current) return;
    if (typeof window === "undefined") return;
    if (document.visibilityState !== "visible") return;
    if (dismissedRef.current) return;

    const current = await fetchAssetSignature();
    if (!current) return;
    if (initialSigRef.current === null) {
      initialSigRef.current = current;
      return;
    }
    if (current !== initialSigRef.current) {
      if (isSnoozed()) return;
      setStatus("available");
      setLastChecked(new Date());
    }
  }, [isSnoozed]);

  const check = useCallback(async () => {
    if (tauri.current) await checkTauri();
    else await checkWeb();
  }, [checkTauri, checkWeb]);

  /* Verificação inicial + intervalo + visibility */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const prefs = loadUpdatePrefs();
    if (!prefs.autoCheck) return;

    void check();
    const interval = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void check();
    };
    const onFocus = () => void check();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [check]);

  const applyUpdate = useCallback(async () => {
    setError(null);
    setIsApplying(true);
    if (!tauri.current) {
      // web: simplesmente recarrega após pequena pausa
      try {
        localStorage.removeItem(SNOOZE_KEY);
      } catch {
        /* ignore */
      }
      setStatus("ready");
      window.setTimeout(() => window.location.reload(), 300);
      return;
    }

    try {
      type TauriUpdate = Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater")["check"]>>;
      let update = updateRef.current as TauriUpdate | null;
      if (!update) {
        const { check } = await import("@tauri-apps/plugin-updater");
        update = await check();
      }
      if (!update) {
        setIsApplying(false);
        setStatus("idle");
        return;
      }
      setStatus("downloading");
      setProgress(0);
      setDownloaded(0);
      setContentLength(null);
      let received = 0;
      let total: number | null = null;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? null;
            setContentLength(total);
            break;
          case "Progress":
            received += event.data.chunkLength;
            setDownloaded(received);
            if (total) setProgress(Math.min(100, (received / total) * 100));
            break;
          case "Finished":
            setProgress(100);
            setStatus("installing");
            break;
        }
      });
      setStatus("ready");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStatus("error");
      setIsApplying(false);
    }
  }, []);

  const restart = useCallback(async () => {
    if (!tauri.current) {
      window.location.reload();
      return;
    }
    try {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  }, []);

  const snooze = useCallback(() => {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    } catch {
      /* ignore */
    }
    setStatus((s) => (s === "available" ? "idle" : s));
  }, []);

  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    setStatus((s) => (s === "available" ? "idle" : s));
  }, []);

  return {
    isTauri: tauri.current,
    online,
    status,
    updateAvailable: status === "available" || status === "downloading" || status === "installing" || status === "ready",
    currentVersion,
    newVersion,
    releaseDate,
    releaseNotes,
    contentLength,
    downloaded,
    progress,
    error,
    lastChecked,
    isApplying,
    check,
    applyUpdate,
    restart,
    snooze,
    dismiss,
  };
}
