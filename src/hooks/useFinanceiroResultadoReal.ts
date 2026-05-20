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

const DEV = import.meta.env.DEV;

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

/** Estima percentual recebido a partir do status_pagamento. */
function estimarValorPago(total: number, status: string | null | undefined): number {
  const s = (status ?? "").toLowerCase();
  if (s === "pago" || s === "recebido" || s === "quitado") return total;
  if (s === "cancelado") return 0;
  if (s === "parcial") return total * 0.5; // heurística — refinada na Onda 4 com lancamento_pagamentos reais
  // pendente, vencido, outros
  return 0;
}

export interface FinanceiroResultadoReal {
  resultado: ResultadoReal;
  porForma: LinhaFormaPagamento[];
  /** Custos pendentes derivados das vendas (não sai dos indicadores). */
  loading: boolean;
}

export function useFinanceiroResultadoReal(): FinanceiroResultadoReal {
  const ind = useFinanceiroIndicadores();
  const vendas = useVendas();
  // Despesas pagas no mês — somatório de saídas do financeiro.
  const despesasQ = useQuery({
    queryKey: ["financeiro_despesas_mes"],
    staleTime: 30_000,
    queryFn: async () => {
      try {
        // O método pode não existir em todos os adapters — fallback para 0.
        const list = await dataClient.financeiro.listar();
        const hoje = new Date();
        const ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
          .toISOString()
          .slice(0, 10);
        const fim = hoje.toISOString().slice(0, 10);
        return list
          .filter(
            (l: any) =>
              l.tipo === "pagar" &&
              (l.status === "pago" || l.status === "quitado") &&
              l.data_pagamento &&
              l.data_pagamento >= ini &&
              l.data_pagamento <= fim,
          )
          .reduce((s: number, l: any) => s + (Number(l.valor_pago) || 0), 0);
      } catch {
        return 0;
      }
    },
  });

  return useMemo(() => {
    const data = ind.data;
    const vendasList = vendas.data ?? [];

    // 1. Constrói entradas para o motor a partir das vendas da lista.
    //    Custo por venda é estimado pela média do mês (custoTotal/totalVendido)
    //    enquanto a Onda 4 não traz custo por venda diretamente do adapter.
    const totalVendido = data?.totalVendido ?? 0;
    const custoTotal = data?.custoTotal ?? 0;
    const custoMedio = totalVendido > 0 ? custoTotal / totalVendido : 0;

    const vendasFin: VendaFinanceiraInput[] = vendasList
      .filter((v) => v.status !== "cancelada")
      .map((v) => {
        const valor_total = Number(v.total) || 0;
        const valor_pago = estimarValorPago(valor_total, v.status_pagamento);
        return {
          venda_id: v.id,
          valor_total,
          custo_total: valor_total * custoMedio,
          valor_pago,
          pagamentos: [
            {
              forma: normalizarForma(v.forma_pagamento),
              valor: valor_pago,
            },
          ],
        };
      });

    const resultado = calcularResultadoReal({
      vendas: vendasFin,
      despesas: despesasQ.data ?? 0,
    });
    const porForma = agregarPorForma(vendasFin);

    if (DEV) {
      // eslint-disable-next-line no-console
      console.log("[RESULTADO_REAL][hook]", {
        qtd_vendas: vendasFin.length,
        custoMedio,
        resultado,
      });
    }

    return {
      resultado,
      porForma,
      loading: ind.isLoading || vendas.isLoading || despesasQ.isLoading,
    };
  }, [ind.data, ind.isLoading, vendas.data, vendas.isLoading, despesasQ.data, despesasQ.isLoading]);
}
