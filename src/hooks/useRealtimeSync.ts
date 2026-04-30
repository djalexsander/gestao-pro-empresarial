import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invalidationBus, type DataDomain } from "@/integrations/data/realtime";

/**
 * Mapeamento tabela → domínio canônico (Bloco 15).
 *
 * Antes (Bloco 14): este hook invalidava queryKeys diretamente.
 * Agora: ele PUBLICA no `invalidationBus` por domínio. Hooks de leitura
 * assinam via `useDomainInvalidation` (ou diretamente `bus.subscribe`).
 *
 * Vantagem: amanhã, num cenário de servidor local + LAN, basta trocar a
 * fonte que publica no bus (WebSocket LAN, EventEmitter local, polling) —
 * a camada de hooks NÃO MUDA.
 */
const TABLE_TO_DOMAIN: Record<string, DataDomain[]> = {
  vendas: ["vendas", "caixa"],
  venda_itens: ["vendas"],
  caixas: ["caixa", "terminais"],
  caixa_movimentos: ["caixa"],
  produtos: ["produtos", "estoque"],
  estoque_movimentacoes: ["estoque", "produtos", "lotes"],
  financeiro_lancamentos: ["financeiro"],
  terminais: ["terminais"],
  clientes: ["clientes"],
  fornecedores: ["fornecedores"],
  funcionarios: ["funcionarios"],
  categorias_produto: ["categorias_produto", "produtos"],
  categorias_financeiras: ["categorias_financeiras"],
  lotes_produto: ["lotes", "estoque"],
};

/**
 * Hook GLOBAL: assina realtime nas tabelas críticas e PUBLICA no
 * `invalidationBus` os domínios afetados. Deve ser usado UMA vez na raiz
 * autenticada do app.
 */
export function useRealtimeSync(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;

    const channel = supabase.channel("rede-terminais");

    for (const table of Object.keys(TABLE_TO_DOMAIN)) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const domains = TABLE_TO_DOMAIN[table] ?? [];
          for (const d of domains) {
            invalidationBus.publish({
              domain: d,
              op: payload?.eventType ?? "*",
              source: "supabase",
            });
          }
        },
      );
    }

    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled]);
}
