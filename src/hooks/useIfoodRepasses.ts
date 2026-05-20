/**
 * Hook Onda 5 — Repasses iFood detalhados.
 *
 * Lê diretamente a tabela `ifood_repasses` via supabase. RLS já garante owner.
 * Retorna últimos N repasses do período + totais (bruto, taxa, líquido).
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface IfoodRepasse {
  id: string;
  data_repasse: string;
  numero_repasse: string | null;
  valor_bruto: number;
  taxa_total: number;
  valor_liquido: number;
  qtd_lancamentos: number;
  observacao: string | null;
}

export interface IfoodRepassesResumo {
  repasses: IfoodRepasse[];
  total_bruto: number;
  total_taxa: number;
  total_liquido: number;
  qtd_repasses: number;
  taxa_media_pct: number;
}

export function useIfoodRepasses(limit = 30): IfoodRepassesResumo & { isLoading: boolean } {
  const q = useQuery({
    queryKey: ["ifood_repasses", limit],
    queryFn: async (): Promise<IfoodRepasse[]> => {
      const { data, error } = await supabase
        .from("ifood_repasses")
        .select(
          "id, data_repasse, numero_repasse, valor_bruto, taxa_total, valor_liquido, qtd_lancamentos, observacao",
        )
        .order("data_repasse", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        valor_bruto: Number(r.valor_bruto) || 0,
        taxa_total: Number(r.taxa_total) || 0,
        valor_liquido: Number(r.valor_liquido) || 0,
        qtd_lancamentos: Number(r.qtd_lancamentos) || 0,
      }));
    },
    staleTime: 60_000,
  });

  const resumo = useMemo(() => {
    const repasses = q.data ?? [];
    let bruto = 0, taxa = 0, liq = 0;
    for (const r of repasses) {
      bruto += r.valor_bruto;
      taxa += r.taxa_total;
      liq += r.valor_liquido;
    }
    return {
      repasses,
      total_bruto: bruto,
      total_taxa: taxa,
      total_liquido: liq,
      qtd_repasses: repasses.length,
      taxa_media_pct: bruto > 0 ? (taxa / bruto) * 100 : 0,
    };
  }, [q.data]);

  return { ...resumo, isLoading: q.isLoading };
}
