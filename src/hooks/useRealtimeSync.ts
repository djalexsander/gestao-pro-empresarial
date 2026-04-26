import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Mapeamento tabela → query keys que devem ser invalidadas quando
 * houver QUALQUER mudança naquela tabela em outro terminal.
 *
 * Mantemos enxuto: tabelas críticas para operação multi-caixa.
 */
const TABLE_TO_QUERY_KEYS: Record<string, string[][]> = {
  vendas: [["vendas"], ["dashboard"], ["caixa-resumo"], ["caixa-aberto"]],
  venda_itens: [["vendas"]],
  caixas: [["caixa-aberto"], ["caixa-resumo"], ["caixas"], ["terminais"]],
  caixa_movimentos: [["caixa-resumo"], ["caixa-aberto"]],
  produtos: [["produtos"]],
  estoque_movimentacoes: [["estoque"], ["produtos"]],
  financeiro_lancamentos: [
    ["financeiro"],
    ["financeiro-indicadores"],
    ["dashboard"],
  ],
  terminais: [["terminais"]],
};

/**
 * Hook GLOBAL: assina realtime nas tabelas críticas e invalida
 * automaticamente as queries do React Query quando algo muda
 * (em qualquer terminal conectado à mesma base).
 *
 * Deve ser usado UMA vez na raiz autenticada do app.
 */
export function useRealtimeSync(enabled: boolean = true) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    const channel = supabase
      .channel("rede-terminais")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "vendas" },
        () => invalidate(qc, TABLE_TO_QUERY_KEYS.vendas),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "venda_itens" },
        () => invalidate(qc, TABLE_TO_QUERY_KEYS.venda_itens),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "caixas" },
        () => invalidate(qc, TABLE_TO_QUERY_KEYS.caixas),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "caixa_movimentos" },
        () => invalidate(qc, TABLE_TO_QUERY_KEYS.caixa_movimentos),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "produtos" },
        () => invalidate(qc, TABLE_TO_QUERY_KEYS.produtos),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "estoque_movimentacoes" },
        () => invalidate(qc, TABLE_TO_QUERY_KEYS.estoque_movimentacoes),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "financeiro_lancamentos" },
        () => invalidate(qc, TABLE_TO_QUERY_KEYS.financeiro_lancamentos),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "terminais" },
        () => invalidate(qc, TABLE_TO_QUERY_KEYS.terminais),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, qc]);
}

function invalidate(
  qc: ReturnType<typeof useQueryClient>,
  keys: string[][] | undefined,
) {
  if (!keys) return;
  for (const k of keys) {
    qc.invalidateQueries({ queryKey: k });
  }
}
