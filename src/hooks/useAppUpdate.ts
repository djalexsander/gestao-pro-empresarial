import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Detecta se há uma nova versão do app publicada comparando o conteúdo
 * de `/index.html` (servido pelo host) com a versão carregada inicialmente.
 *
 * Funciona sem service worker — compatível com o preview da Lovable e com
 * o app publicado. Não interrompe o uso normal: roda em segundo plano.
 */

const CHECK_INTERVAL_MS = 2 * 60 * 1000; // 2 minutos
const SNOOZE_MS = 10 * 60 * 1000; // "Depois" reaparece em 10 min
const SNOOZE_KEY = "app-update:snoozed-until";

async function fetchIndexHash(): Promise<string | null> {
  try {
    const res = await fetch(`/?_v=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Cache-Control": "no-cache" },
    });
    if (!res.ok) return null;
    // Prefer ETag (estável e barato). Senão, hash leve do corpo.
    const etag = res.headers.get("etag") || res.headers.get("last-modified");
    if (etag) return etag;
    const text = await res.text();
    // Hash determinístico simples (FNV-1a) para evitar dependências.
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return String(h >>> 0);
  } catch {
    return null;
  }
}

export interface AppUpdateState {
  updateAvailable: boolean;
  isApplying: boolean;
  applyUpdate: () => void;
  snooze: () => void;
  dismiss: () => void;
}

export function useAppUpdate(): AppUpdateState {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const initialHashRef = useRef<string | null>(null);
  const dismissedRef = useRef(false);

  const isSnoozed = useCallback(() => {
    try {
      const until = Number(localStorage.getItem(SNOOZE_KEY) || "0");
      return until > Date.now();
    } catch {
      return false;
    }
  }, []);

  const check = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (document.visibilityState !== "visible") return;
    if (dismissedRef.current) return;

    const current = await fetchIndexHash();
    if (!current) return;

    if (initialHashRef.current === null) {
      initialHashRef.current = current;
      return;
    }

    if (current !== initialHashRef.current) {
      if (isSnoozed()) return;
      setUpdateAvailable(true);
    }
  }, [isSnoozed]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Captura o hash inicial logo após o mount
    void check();

    const interval = window.setInterval(() => {
      void check();
    }, CHECK_INTERVAL_MS);

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

  const applyUpdate = useCallback(() => {
    setIsApplying(true);
    try {
      localStorage.removeItem(SNOOZE_KEY);
    } catch {
      // ignore
    }
    // Pequeno delay para permitir feedback visual
    window.setTimeout(() => {
      // Reload puro: força o navegador a buscar nova versão dos assets
      window.location.reload();
    }, 350);
  }, []);

  const snooze = useCallback(() => {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    } catch {
      // ignore
    }
    setUpdateAvailable(false);
  }, []);

  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    setUpdateAvailable(false);
  }, []);

  return { updateAvailable, isApplying, applyUpdate, snooze, dismiss };
}
