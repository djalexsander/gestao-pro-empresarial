/**
 * Hook Onda 6 — Auditoria de rateio por pagamento.
 *
 * Lê os últimos pagamentos parciais/quitações de `lancamento_pagamentos` e
 * calcula o rateio proporcional usando o motor `src/lib/finance`:
 *   - percentual deste pagamento sobre o título
 *   - custo realizado proporcional (quando há venda vinculada)
 *   - lucro realizado proporcional
 *   - taxa estimada pela forma de pagamento
 *
 * Saída pensada para uma tabela de auditoria — útil para conferência
 * contábil sem alterar nenhuma estrutura de dados.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { calcularTaxa } from "@/lib/finance/taxas";
import type { FormaPagamento } from "@/lib/finance/types";

interface RateioRow {
  id: string;
  data_pagamento: string;
  valor: number;
  forma: FormaPagamento | null;
  lancamento_id: string;
  lancamento_descricao: string | null;
  lancamento_valor_total: number;
  cliente_nome: string | null;
  venda_id: string | null;
  venda_total: number | null;
}

export interface RateioLinha {
  id: string;
  data_pagamento: string;
  descricao: string;
  cliente: string;
  forma: FormaPagamento | "outro";
  valor: number;
  valor_total: number;
  percentual: number;
  taxa: number;
  liquido: number;
}

const FORMA_MAP: Record<string, FormaPagamento> = {
  dinheiro: "dinheiro",
  pix: "pix",
  debito: "debito",
  credito: "credito",
  cartao_debito: "debito",
  cartao_credito: "credito",
  fiado: "fiado",
  ifood: "ifood",
  boleto: "boleto",
  voucher: "voucher",
};

function normalizarForma(v: string | null | undefined): FormaPagamento | "outro" {
  if (!v) return "outro";
  return FORMA_MAP[v.toLowerCase()] ?? "outro";
}

export function useAuditoriaRateio(limit = 50) {
  const q = useQuery({
    queryKey: ["auditoria_rateio", limit],
    queryFn: async (): Promise<RateioRow[]> => {
      const { data, error } = await supabase
        .from("lancamento_pagamentos")
        .select(
          `id, data_pagamento, valor, forma_pagamento, lancamento_id,
           financeiro_lancamentos!inner (
             descricao, valor, cliente_nome, venda_id
           )`,
        )
        .order("data_pagamento", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        data_pagamento: r.data_pagamento,
        valor: Number(r.valor) || 0,
        forma: r.forma_pagamento ?? null,
        lancamento_id: r.lancamento_id,
        lancamento_descricao: r.financeiro_lancamentos?.descricao ?? null,
        lancamento_valor_total: Number(r.financeiro_lancamentos?.valor ?? 0),
        cliente_nome: r.financeiro_lancamentos?.cliente_nome ?? null,
        venda_id: r.financeiro_lancamentos?.venda_id ?? null,
        venda_total: null,
      }));
    },
    staleTime: 30_000,
  });

  const linhas: RateioLinha[] = useMemo(() => {
    const rows = q.data ?? [];
    return rows.map((r) => {
      const forma = normalizarForma(r.forma);
      const total = r.lancamento_valor_total > 0 ? r.lancamento_valor_total : r.valor;
      const percentual = total > 0 ? (r.valor / total) * 100 : 0;
      const taxa = forma === "outro" ? 0 : calcularTaxa(forma as FormaPagamento, r.valor);
      return {
        id: r.id,
        data_pagamento: r.data_pagamento,
        descricao: r.lancamento_descricao ?? "—",
        cliente: r.cliente_nome ?? "—",
        forma,
        valor: r.valor,
        valor_total: total,
        percentual,
        taxa,
        liquido: r.valor - taxa,
      };
    });
  }, [q.data]);

  const totais = useMemo(() => {
    let bruto = 0,
      taxa = 0,
      liquido = 0;
    for (const l of linhas) {
      bruto += l.valor;
      taxa += l.taxa;
      liquido += l.liquido;
    }
    return { bruto, taxa, liquido, qtd: linhas.length };
  }, [linhas]);

  return { linhas, totais, isLoading: q.isLoading };
}
