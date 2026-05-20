import { createContext, useContext, useMemo } from "react";
import { useLocalRealtime } from "@/hooks/useLocalRealtime";
import { useDesktopConfig } from "@/integrations/desktop/configStore";
import { getBaseUrl } from "@/integrations/desktop/serverConnection";
import { useEmpresaAtual } from "@/hooks/useEmpresa";
import type { RealtimeStatus } from "@/integrations/realtime/localRealtimeClient";

const Ctx = createContext<{ status: RealtimeStatus }>({ status: "idle" });

export function LocalRealtimeProvider({ children }: { children: React.ReactNode }) {
  // useDesktopConfig pode não existir em todos os builds — fallback seguro.
  let baseUrl: string | null = null;
  try {
    const cfg = useDesktopConfig?.();
    const terminal = cfg?.terminal ?? cfg?.serverConfig ?? null;
    baseUrl = terminal ? getBaseUrl(terminal) : null;
  } catch {
    baseUrl = null;
  }

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
