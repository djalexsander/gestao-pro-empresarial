import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Detecta se há uma nova versão do app publicada comparando as referências
 * de assets (scripts e stylesheets) no `index.html`.
 *
 * Por que não comparar o HTML inteiro?
 *   No preview/host da Lovable o HTML contém marcações dinâmicas (scripts
 *   injetados pelo `lovable.js`, IDs de sessão, comentários de build) que
 *   mudam a cada request — gerava falsos positivos a cada 2 min.
 *
 * Estratégia:
 *   - Buscar `/` com cache-bust.
 *   - Extrair APENAS as URLs dos <script type="module" src=...> e
 *     <link rel="stylesheet" href=...>. O Vite gera hashes estáveis nesses
 *     nomes, então só mudam em um build novo de verdade.
 *   - Comparar a assinatura ordenada dessas URLs com a inicial.
 */

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos
const SNOOZE_MS = 30 * 60 * 1000; // "Depois" silencia por 30 min
const SNOOZE_KEY = "app-update:snoozed-until";

/** Extrai assinatura estável a partir do HTML do index. */
function extractAssetSignature(html: string): string | null {
  try {
    // Captura URLs de scripts module e stylesheets — atributos podem estar em qualquer ordem.
    const scriptRegex =
      /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>|<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*\btype=["']module["'][^>]*>/gi;
    const linkRegex =
      /<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["'][^>]*>|<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']stylesheet["'][^>]*>/gi;

    const urls = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = scriptRegex.exec(html))) urls.add(m[1] ?? m[2]);
    while ((m = linkRegex.exec(html))) urls.add(m[1] ?? m[2]);

    // Filtra runtime injetado por terceiros (ex.: cdn.gpteng.co/lovable.js) que
    // pode mudar independentemente do build do app.
    const filtered = [...urls].filter((u) => {
      if (!u) return false;
      // Mantém apenas assets servidos do mesmo host (caminhos relativos ou
      // do próprio domínio). URLs absolutas externas são descartadas.
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
  applyUpdate: () => void;
  snooze: () => void;
  dismiss: () => void;
}

export function useAppUpdate(): AppUpdateState {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const initialSigRef = useRef<string | null>(null);
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

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Captura assinatura inicial após o mount
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
    window.setTimeout(() => {
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
