/**
 * Hook Onda 2 — Resultado financeiro real.
 *
 * Consome os indicadores já existentes (`useFinanceiroIndicadores`) e a lista
 * de vendas (`useVendas`) e passa pelo motor `src/lib/finance` para devolver:
 *   - receita bruta / líquida
 *   - recebido / previsto / pendente
 *   - custos realizados / pendentes
 *   - lucro bruto / líquido
 *   - taxas
 *   - resultado operacional real
 *   - vendas por forma de pagamento
 *
 * Não altera nenhum adapter — derivação 100% client-side a partir de dados
 * que já estavam no cache. Funciona online, local-server e offline.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/auth/AuthProvider";
import { dataClient } from "@/integrations/data/client";
import type { LancamentoDetalhe } from "@/components/financeiro/LancamentoDetalheDialog";
import { useFinanceiroIndicadores } from "./useFinanceiroIndicadores";
import { useVendas } from "./useVendas";
import {
  agregarPorForma,
  calcularResultadoReal,
  type FormaPagamento,
  type LinhaFormaPagamento,
  type ResultadoReal,
  type VendaFinanceiraInput,
} from "@/lib/finance";

// DEV log gating removido junto com os console.log abaixo.

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

function normalizarForma(v: string | null | undefined): FormaPagamento {
  if (!v) return "outro";
  return FORMA_MAP[v.toLowerCase()] ?? "outro";
}

/**
 * Estima percentual recebido a partir do status_pagamento.
 * Usado APENAS como fallback quando não há lançamento financeiro vinculado.
 * Quando existem `financeiro_lancamentos` da venda, o valor_pago real é usado.
 */
function estimarValorPago(total: number, status: string | null | undefined): number {
  const s = (status ?? "").toLowerCase();
  if (s === "pago" || s === "recebido" || s === "quitado") return total;
  if (s === "cancelado") return 0;
  if (s === "parcial") return total * 0.5;
  return 0;
}

export interface FinanceiroResultadoReal {
  resultado: ResultadoReal;
  porForma: LinhaFormaPagamento[];
  /** Custos pendentes derivados das vendas (não sai dos indicadores). */
  loading: boolean;
}

export function useFinanceiroResultadoReal(): FinanceiroResultadoReal {
  const { user } = useAuth();
  const ind = useFinanceiroIndicadores();
  const vendas = useVendas();
  const lancamentosQ = useQuery({
    queryKey: ["financeiro_lancamentos", user?.id],
    enabled: !!user,
    queryFn: async () =>
      (await dataClient.financeiro.listLancamentosCompleto()) as LancamentoDetalhe[],
    staleTime: 30_000,
  });

  return useMemo(() => {
    const data = ind.data;
    const vendasList = vendas.data ?? [];
    const lancs = lancamentosQ.data ?? [];

    const totalVendido = data?.totalVendido ?? 0;
    const custoTotal = data?.custoTotal ?? 0;
    const custoMedio = totalVendido > 0 ? custoTotal / totalVendido : 0;

    // Agrega valor_pago REAL por venda_id a partir de financeiro_lancamentos.
    const pagoPorVenda = new Map<string, number>();
    const temLancPorVenda = new Set<string>();
    for (const l of lancs) {
      if (l.tipo !== "receber") continue;
      const vid = (l as { venda_id?: string | null }).venda_id;
      if (!vid) continue;
      temLancPorVenda.add(vid);
      if (l.status === "cancelado") continue;
      pagoPorVenda.set(vid, (pagoPorVenda.get(vid) ?? 0) + (Number(l.valor_pago) || 0));
    }

    const vendasFin: VendaFinanceiraInput[] = vendasList
      .filter((v) => v.status !== "cancelada")
      .map((v) => {
        const valor_total = Number(v.total) || 0;
        const temLanc = temLancPorVenda.has(v.id);
        const valor_pago = temLanc
          ? Math.min(valor_total, pagoPorVenda.get(v.id) ?? 0)
          : estimarValorPago(valor_total, v.status_pagamento);
        return {
          venda_id: v.id,
          valor_total,
          custo_total: valor_total * custoMedio,
          valor_pago,
          pagamentos: [
            { forma: normalizarForma(v.forma_pagamento), valor: valor_pago },
          ],
        };
      });

    // Despesas administrativas pagas — soma de lançamentos a pagar quitados.
    let despesas = 0;
    for (const l of lancs) {
      if (l.tipo === "pagar" && (l.status === "pago" || l.status === "recebido")) {
        despesas += Number(l.valor_pago ?? l.valor) || 0;
      }
    }

    const resultado = calcularResultadoReal({ vendas: vendasFin, despesas });
    const porForma = agregarPorForma(vendasFin);

    // Logs DEV removidos: rodavam a cada render e poluíam o console quando
    // a árvore re-renderizava em cascata. Cálculo permanece puro.


    return {
      resultado,
      porForma,
      loading: ind.isLoading || vendas.isLoading || lancamentosQ.isLoading,
    };
  }, [ind.data, ind.isLoading, vendas.data, vendas.isLoading, lancamentosQ.data, lancamentosQ.isLoading]);
}


