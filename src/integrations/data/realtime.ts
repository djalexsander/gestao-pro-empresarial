/**
 * ============================================================================
 * Invalidation Bus por domínio (Bloco 15)
 * ============================================================================
 *
 * Objetivo: desacoplar os hooks de leitura da fonte do evento de mudança.
 *
 * Hoje: `useRealtimeSync` ouve Supabase Realtime e publica eventos canônicos
 * neste bus (ex.: `bus.publish("produtos")`). Hooks/componentes que precisam
 * reagir a mudanças assinam via `bus.subscribe("produtos", () => ...)` —
 * em geral via o utilitário `useDomainInvalidation` que invalida queryKeys.
 *
 * Amanhã (servidor local + LAN): basta trocar a fonte que publica no bus —
 * pode ser um WebSocket LAN, pode ser um EventEmitter local em
 * single-terminal, pode ser polling. A camada de hooks NÃO MUDA.
 *
 * Princípios:
 *  - 1 evento por domínio (não por tabela). `produtos` cobre tanto
 *    `produtos` quanto `produto_codigos`/`produto_variacoes`. Quem se
 *    importa com a mudança decide o que invalidar.
 *  - Sem payload obrigatório. Quem precisa de detalhes refetcha. Isso evita
 *    acoplar consumidores ao formato do evento (cloud vs LAN podem diferir).
 *  - Subscriptions são síncronas e cheap; o bus apenas itera handlers.
 */

export type DataDomain =
  | "produtos"
  | "estoque"
  | "lotes"
  | "clientes"
  | "fornecedores"
  | "categorias_produto"
  | "categorias_financeiras"
  | "funcionarios"
  | "caixa"
  | "vendas"
  | "financeiro"
  | "terminais";

/**
 * Detalhe opcional do evento. Quem produz o evento pode passar o que tem;
 * quem consome pode ignorar. Mantém o bus serializável (cloud Realtime ou
 * WebSocket LAN entregam coisas parecidas).
 */
export interface DomainEvent {
  domain: DataDomain;
  /** "INSERT" | "UPDATE" | "DELETE" | "*" — opcional, pode estar ausente. */
  op?: "INSERT" | "UPDATE" | "DELETE" | "*";
  /** Identificador da linha afetada, se conhecido. */
  id?: string;
  /** Origem do evento, útil para evitar loops (ex.: ignorar próprio terminal). */
  source?: "supabase" | "local-ws" | "local-emitter" | "polling" | "manual";
}

type Handler = (event: DomainEvent) => void;

class InvalidationBus {
  private handlers = new Map<DataDomain, Set<Handler>>();

  subscribe(domain: DataDomain, handler: Handler): () => void {
    let set = this.handlers.get(domain);
    if (!set) {
      set = new Set();
      this.handlers.set(domain, set);
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
    };
  }

  publish(eventOrDomain: DataDomain | DomainEvent): void {
    const event: DomainEvent =
      typeof eventOrDomain === "string"
        ? { domain: eventOrDomain }
        : eventOrDomain;
    const set = this.handlers.get(event.domain);
    if (!set || set.size === 0) return;
    // Snapshot defensivo: handlers podem unsubscribe no callback.
    for (const h of Array.from(set)) {
      try {
        h(event);
      } catch (e) {
        // Nunca deixar 1 handler quebrar os outros.
        // eslint-disable-next-line no-console
        console.error("[invalidationBus] handler error", e);
      }
    }
  }
}

/**
 * Singleton. É seguro porque é apenas memória local do tab/processo.
 * Em SSR ele simplesmente nunca recebe eventos (ninguém publica), o que
 * é o comportamento desejado.
 */
export const invalidationBus = new InvalidationBus();
