import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Detecta nova versão do app.
 *
 * - No desktop (Tauri): usa @tauri-apps/plugin-updater (mesmo fluxo da aba
 *   Configurações > Atualizações), verifica ao iniciar e a cada 30 min.
 * - Na web: compara a assinatura de assets do index.html para detectar
 *   novo deploy.
 */

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const DESKTOP_CHECK_INTERVAL_MS = 30 * 60 * 1000;
const SNOOZE_MS = 30 * 60 * 1000;
const SNOOZE_KEY = "app-update:snoozed-until";

function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.__TAURI_INTERNALS__) || Boolean(w.__TAURI__) || Boolean(w.isTauri);
}

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

export interface AppUpdateState {
  updateAvailable: boolean;
  isApplying: boolean;
  newVersion: string | null;
  applyUpdate: () => void;
  snooze: () => void;
  dismiss: () => void;
}

export function useAppUpdate(): AppUpdateState {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [newVersion, setNewVersion] = useState<string | null>(null);
  const initialSigRef = useRef<string | null>(null);
  const dismissedRef = useRef(false);
  const tauriRef = useRef(false);

  const isSnoozed = useCallback(() => {
    try {
      const until = Number(localStorage.getItem(SNOOZE_KEY) || "0");
      return until > Date.now();
    } catch {
      return false;
    }
  }, []);

  const checkWeb = useCallback(async () => {
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
      setUpdateAvailable(true);
    }
  }, [isSnoozed]);

  const checkTauri = useCallback(async () => {
    if (dismissedRef.current) return;
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        if (isSnoozed()) return;
        setNewVersion(update.version);
        setUpdateAvailable(true);
      } else {
        setUpdateAvailable(false);
        setNewVersion(null);
      }
    } catch {
      // silencioso — não travar app
    }
  }, [isSnoozed]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const inTauri = isTauriRuntime();
    tauriRef.current = inTauri;

    const run = () => {
      if (inTauri) void checkTauri();
      else void checkWeb();
    };

    run();

    const interval = window.setInterval(
      run,
      inTauri ? DESKTOP_CHECK_INTERVAL_MS : CHECK_INTERVAL_MS,
    );
    const onVisibility = () => {
      if (document.visibilityState === "visible") run();
    };
    const onFocus = () => run();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [checkTauri, checkWeb]);

  const applyUpdate = useCallback(() => {
    setIsApplying(true);
    try {
      localStorage.removeItem(SNOOZE_KEY);
    } catch {
      /* ignore */
    }

    if (tauriRef.current) {
      void (async () => {
        try {
          const { check } = await import("@tauri-apps/plugin-updater");
          const update = await check();
          if (!update) {
            setIsApplying(false);
            setUpdateAvailable(false);
            return;
          }
          await update.downloadAndInstall();
        } catch {
          setIsApplying(false);
        }
      })();
      return;
    }

    window.setTimeout(() => {
      window.location.reload();
    }, 350);
  }, []);

  const snooze = useCallback(() => {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    } catch {
      /* ignore */
    }
    setUpdateAvailable(false);
  }, []);

  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    setUpdateAvailable(false);
  }, []);

  return { updateAvailable, isApplying, newVersion, applyUpdate, snooze, dismiss };
}
