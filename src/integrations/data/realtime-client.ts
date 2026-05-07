/**
 * realtimeClient — resolve qual `RealtimeAdapter` está ativo, no mesmo
 * espírito do `dataClient`. Hoje só existe a implementação cloud
 * (Supabase). Quando entrar o servidor local, este resolver retorna
 * `LanWebSocketRealtimeAdapter` (ou um composite cloud+LAN).
 *
 * O hook `useRealtimeSync` chama `realtimeClient.start()` — não precisa
 * conhecer nenhuma fonte específica.
 */

import { getDataMode } from "./mode";
import { supabaseRealtimeAdapter } from "./adapters/cloud-realtime";
import type { RealtimeAdapter } from "./realtime-adapter";

let cached: RealtimeAdapter | null = null;

export function getRealtimeAdapter(): RealtimeAdapter {
  if (cached) return cached;

  const mode = getDataMode();
  switch (mode) {
    case "cloud":
      cached = supabaseRealtimeAdapter;
      return cached;
    // Futuro:
    // case "local-server":
    //   cached = new LanWebSocketRealtimeAdapter(); break;
    // case "hybrid":
    //   cached = new CompositeRealtimeAdapter([
    //     supabaseRealtimeAdapter,
    //     new LanWebSocketRealtimeAdapter(),
    //   ]); break;
    default:
      cached = supabaseRealtimeAdapter;
      return cached;
  }
}

/** Atalho ergonômico, espelhando `dataClient`. */
export const realtimeClient = {
  start: (...args: Parameters<RealtimeAdapter["start"]>) =>
    getRealtimeAdapter().start(...args),
  get source() {
    return getRealtimeAdapter().source;
  },
  subscribeDomain: (
    ...args: Parameters<NonNullable<RealtimeAdapter["subscribeDomain"]>>
  ) => {
    const adapter = getRealtimeAdapter();
    const fn = adapter.subscribeDomain;
    if (!fn) {
      throw new Error("Adapter ativo não implementa subscribeDomain");
    }
    return fn.call(adapter, ...args);
  },
  subscribeTable: <TRow = Record<string, unknown>>(
    filter: Parameters<RealtimeAdapter["subscribeTable"]>[0],
    handler: (event: import("./realtime-adapter").RealtimeTableEvent<TRow>) => void,
  ) => getRealtimeAdapter().subscribeTable<TRow>(filter, handler),
};
