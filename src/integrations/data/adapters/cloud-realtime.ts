/**
 * SupabaseRealtimeAdapter — implementação cloud do `RealtimeAdapter`.
 *
 * Reproduz exatamente o comportamento que vivia dentro do `useRealtimeSync`
 * antes do Bloco 16: assina `postgres_changes` em todas as tabelas
 * críticas e roteia pra o `invalidationBus`. Zero mudança de comportamento.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  defaultSubscribeDomain,
  publishTableChange,
  realtimeTables,
  type RealtimeAdapter,
  type RealtimeStartOptions,
  type RealtimeStop,
  type RealtimeTableFilter,
  type RealtimeTableEvent,
} from "../realtime-adapter";
import type { DataDomain, DomainEvent } from "../realtime";

export class SupabaseRealtimeAdapter implements RealtimeAdapter {
  readonly source = "supabase" as const;

  start(_options?: RealtimeStartOptions): RealtimeStop {
    const channel = supabase.channel("rede-terminais");

    for (const table of realtimeTables()) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          publishTableChange(
            table,
            payload?.eventType ?? "*",
            "supabase",
            payload?.new?.id ?? payload?.old?.id,
          );
        },
      );
    }

    channel.subscribe();

    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      supabase.removeChannel(channel);
    };
  }

  subscribeDomain(
    domain: DataDomain,
    handler: (event: DomainEvent) => void,
  ): RealtimeStop {
    return defaultSubscribeDomain(domain, handler);
  }

  subscribeTable<TRow = Record<string, unknown>>(
    filter: RealtimeTableFilter,
    handler: (event: RealtimeTableEvent<TRow>) => void,
  ): RealtimeStop {
    const event = filter.event ?? "*";
    const channelName = `adhoc-${filter.table}-${filter.filter ?? "all"}-${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase.channel(channelName).on(
      "postgres_changes",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { event, schema: "public", table: filter.table, ...(filter.filter ? { filter: filter.filter } : {}) } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (payload: any) => {
        handler({
          eventType: payload.eventType,
          new: (payload.new as TRow) ?? null,
          old: (payload.old as TRow) ?? null,
        });
      },
    );
    channel.subscribe();
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      supabase.removeChannel(channel);
    };
  }
}

export const supabaseRealtimeAdapter = new SupabaseRealtimeAdapter();
