import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useLocalRealtime } from "@/hooks/useLocalRealtime";
import {
  getDesktopConfig,
  subscribeDesktopConfig,
} from "@/integrations/desktop/configStore";
import type { DesktopConfig } from "@/integrations/desktop/types";
import { getBaseUrl } from "@/integrations/desktop/serverConnection";
import type { RealtimeStatus } from "@/integrations/realtime/localRealtimeClient";

const Ctx = createContext<{ status: RealtimeStatus }>({ status: "idle" });

const EMPRESA_STORAGE_KEY = "empresa_atual_id";

function readEmpresaIdFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(EMPRESA_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function LocalRealtimeProvider({ children }: { children: React.ReactNode }) {
  // IMPORTANTE: este provider fica no topo da árvore (pode estar acima do
  // AuthProvider/EmpresaProvider em telas de login). Por isso NÃO chamamos
  // hooks como useAuth/useEmpresaAtual aqui — eles podem lançar antes do
  // login e depois passar a funcionar, mudando a contagem de hooks entre
  // renders ("Rendered more hooks than during the previous render").
  // Lemos o empresa_id direto do localStorage, mesma fonte que o
  // useEmpresaAtual usa internamente.
  const [cfg, setCfg] = useState<DesktopConfig>(() => {
    try {
      return getDesktopConfig();
    } catch {
      return {} as DesktopConfig;
    }
  });

  const [empresaId, setEmpresaId] = useState<string | null>(() =>
    readEmpresaIdFromStorage(),
  );

  useEffect(() => {
    try {
      const unsub = subscribeDesktopConfig((next) => setCfg(next));
      return () => unsub();
    } catch {
      return;
    }
  }, []);

  // Reage a mudanças no empresa_id (outra aba ou setEmpresaId que faz
  // reload, mas cobrimos também o caso de hot-update sem reload).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: StorageEvent) => {
      if (e.key === EMPRESA_STORAGE_KEY) {
        setEmpresaId(e.newValue);
      }
    };
    window.addEventListener("storage", handler);

    // Poll leve para o caso da mesma aba (storage event só dispara entre abas).
    const id = window.setInterval(() => {
      const current = readEmpresaIdFromStorage();
      setEmpresaId((prev) => (prev === current ? prev : current));
    }, 2000);

    return () => {
      window.removeEventListener("storage", handler);
      window.clearInterval(id);
    };
  }, []);

  const baseUrl = useMemo(
    () => (cfg?.terminal ? getBaseUrl(cfg.terminal) : null),
    [cfg],
  );

  const { status } = useLocalRealtime({ baseUrl, empresaId });
  const value = useMemo(() => ({ status }), [status]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLocalRealtimeStatus(): RealtimeStatus {
  return useContext(Ctx).status;
}
