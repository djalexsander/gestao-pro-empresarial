/**
 * useDomainInvalidation — ponte entre o invalidationBus e o React Query.
 *
 * Hooks de leitura assinam um domínio e recebem invalidação automática nas
 * queryKeys que indicarem. Isso isola o consumidor da fonte do evento
 * (Supabase Realtime hoje, WebSocket LAN amanhã).
 *
 * Uso típico:
 *   useDomainInvalidation("produtos", [["produtos"], ["produto", id]]);
 *
 * O hook é "inerte" se não houver subscribers — não custa CPU em telas que
 * não usam.
 */
import { useEffect } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { invalidationBus, type DataDomain, type DomainEvent } from "@/integrations/data/realtime";

export function useDomainInvalidation(
  domain: DataDomain,
  queryKeys: QueryKey[],
  options?: {
    /** Callback custom além do invalidate. Útil quando precisa lógica extra. */
    onEvent?: (event: DomainEvent) => void;
    /** Se false, não assina (útil para gates condicionais). */
    enabled?: boolean;
  },
) {
  const qc = useQueryClient();
  const enabled = options?.enabled ?? true;
  const onEvent = options?.onEvent;

  // Serializa as keys para uma string estável (deps do useEffect).
  // Aceitamos o custo: invalidação é evento raro, raramente as keys mudam.
  const serializedKeys = JSON.stringify(queryKeys);

  useEffect(() => {
    if (!enabled) return;
    const keys: QueryKey[] = JSON.parse(serializedKeys) as QueryKey[];
    const off = invalidationBus.subscribe(domain, (event) => {
      for (const k of keys) {
        qc.invalidateQueries({ queryKey: k });
      }
      if (onEvent) onEvent(event);
    });
    return off;
  }, [domain, serializedKeys, enabled, qc, onEvent]);
}
