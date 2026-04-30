import { useEffect } from "react";
import { realtimeClient } from "@/integrations/data/realtime-client";

/**
 * Hook GLOBAL: inicializa o `RealtimeAdapter` ativo (Supabase hoje;
 * WebSocket LAN no futuro) e o desliga no cleanup. Não conhece a fonte —
 * o `realtimeClient` resolve a implementação.
 *
 * Deve ser usado UMA vez na raiz autenticada do app.
 *
 * Histórico:
 *  - Bloco 14: invalidava queryKeys diretamente.
 *  - Bloco 15: passou a publicar no `invalidationBus` por domínio.
 *  - Bloco 16: extraiu a lógica para `RealtimeAdapter` (este hook virou
 *    apenas o ciclo de vida React do adapter).
 */
export function useRealtimeSync(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;
    const stop = realtimeClient.start();
    return stop;
  }, [enabled]);
}
