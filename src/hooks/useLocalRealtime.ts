import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isDesktop } from "@/integrations/data/mode";
import {
  localRealtimeClient,
  type RealtimeStatus,
} from "@/integrations/realtime/localRealtimeClient";

/**
 * Conecta o cliente realtime local ao servidor Rust (desktop) e
 * dispara invalidações no React Query.
 *
 * - Web puro: no-op (status fica "idle").
 * - Desktop sem servidor configurado: no-op.
 */
export function useLocalRealtime(opts: {
  baseUrl: string | null;
  empresaId: string | null;
}): { status: RealtimeStatus } {
  const qc = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>(
    localRealtimeClient.getStatus(),
  );

  useEffect(() => {
    const unsub = localRealtimeClient.subscribe(setStatus);
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    if (!isDesktop()) return;
    if (!opts.baseUrl) return;
    localRealtimeClient.connect(opts.baseUrl, opts.empresaId, qc);
    return () => {
      // Não desconecta em re-render — apenas em unmount real do provider.
    };
  }, [opts.baseUrl, opts.empresaId, qc]);

  return { status };
}
