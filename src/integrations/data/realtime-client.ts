import { supabaseRealtimeAdapter } from "./adapters/cloud-realtime";
import type { RealtimeAdapter } from "./realtime-adapter";

export function getRealtimeAdapter(): RealtimeAdapter {
  return supabaseRealtimeAdapter;
}

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
