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
import { defaultSubscribeDomain, type RealtimeAdapter } from "./realtime-adapter";

let cached: { mode: ReturnType<typeof getDataMode>; adapter: RealtimeAdapter } | null = null;

const localNoopRealtimeAdapter: RealtimeAdapter = {
  source: "local-emitter",
  start: () => () => {},
  subscribeDomain: defaultSubscribeDomain,
};

export function getRealtimeAdapter(): RealtimeAdapter {
  const mode = getDataMode();
  if (cached?.mode === mode) return cached.adapter;

  let adapter: RealtimeAdapter;
  switch (mode) {
    case "cloud":
      adapter = supabaseRealtimeAdapter;
      break;
    case "local-server":
    case "local-terminal":
      adapter = localNoopRealtimeAdapter;
      break;
    // Futuro:
    // case "local-server":
    //   cached = new LanWebSocketRealtimeAdapter(); break;
    // case "hybrid":
    //   cached = new CompositeRealtimeAdapter([
    //     supabaseRealtimeAdapter,
    //     new LanWebSocketRealtimeAdapter(),
    //   ]); break;
    default:
      adapter = supabaseRealtimeAdapter;
      break;
  }
  cached = { mode, adapter };
  return adapter;
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
};
