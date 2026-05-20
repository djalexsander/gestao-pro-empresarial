import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useLocalRealtime } from "@/hooks/useLocalRealtime";
import {
  getDesktopConfig,
  subscribeDesktopConfig,
} from "@/integrations/desktop/configStore";
import type { DesktopConfig } from "@/integrations/desktop/types";
import { getBaseUrl } from "@/integrations/desktop/serverConnection";
import { useEmpresaAtual } from "@/hooks/useEmpresa";
import type { RealtimeStatus } from "@/integrations/realtime/localRealtimeClient";

const Ctx = createContext<{ status: RealtimeStatus }>({ status: "idle" });

export function LocalRealtimeProvider({ children }: { children: React.ReactNode }) {
  const [cfg, setCfg] = useState<DesktopConfig>(() => {
    try {
      return getDesktopConfig();
    } catch {
      return {} as DesktopConfig;
    }
  });

  useEffect(() => {
    try {
      const unsub = subscribeDesktopConfig((next) => setCfg(next));
      return () => unsub();
    } catch {
      return;
    }
  }, []);

  const baseUrl = cfg?.terminal ? getBaseUrl(cfg.terminal) : null;

  let empresaId: string | null = null;
  try {
    const { empresaId: id } = useEmpresaAtual();
    empresaId = id ?? null;
  } catch {
    empresaId = null;
  }

  const { status } = useLocalRealtime({ baseUrl, empresaId });
  const value = useMemo(() => ({ status }), [status]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLocalRealtimeStatus(): RealtimeStatus {
  return useContext(Ctx).status;
}

