import type {
  FormaPagamento,
  LinhaFormaPagamento,
  VendaFinanceiraInput,
} from "./types";
import { calcularRateio, ratearPorForma } from "./financeEngine";
import { calcularTaxa, round2 } from "./taxas";

// Logs DEV removidos: rodavam a cada render e poluíam o console em loops
// de re-render. Função permanece pura.

interface AggOpts {
  /** Override de taxa percentual por forma (0..1). */
  taxasOverride?: Partial<Record<FormaPagamento, number>>;
}

/**
 * Agrega vendas por forma de pagamento.
 * - total_vendido: soma do valor da venda atribuída proporcionalmente à forma
 *   (via participação no recebido — para vendas mistas).
 *   Para vendas com pagamento único, equivale ao valor total da venda.
 * - total_recebido: soma efetiva já paga naquela forma.
 * - custo/lucro: rateados proporcionalmente.
 */
export function agregarPorForma(
  vendas: VendaFinanceiraInput[],
  opts: AggOpts = {},
): LinhaFormaPagamento[] {
  const mapa = new Map<FormaPagamento, LinhaFormaPagamento>();

  function ensure(f: FormaPagamento): LinhaFormaPagamento {
    let l = mapa.get(f);
    if (!l) {
      l = {
        forma: f,
        qtd_vendas: 0,
        total_vendido: 0,
        total_recebido: 0,
        total_pendente: 0,
        custo_realizado: 0,
        lucro_bruto: 0,
        taxa: 0,
        lucro_liquido: 0,
        ticket_medio: 0,
      };
      mapa.set(f, l);
    }
    return l;
  }

  for (const v of vendas) {
    const rateio = calcularRateio(v);
    const porForma = ratearPorForma(v, rateio);

    if (porForma.length === 0) {
      // Sem pagamentos — toda a venda fica "fiado/pendente"
      const linha = ensure("fiado");
      linha.qtd_vendas += 1;
      linha.total_vendido += rateio.valor_total;
      linha.total_pendente += rateio.saldo_restante;
      continue;
    }

    for (const r of porForma) {
      const linha = ensure(r.pagamento.forma);
      linha.qtd_vendas += 1;
      // proporção dessa forma no total da venda
      const fatia_venda = rateio.valor_total * r.participacao;
      linha.total_vendido += fatia_venda;
      linha.total_recebido += r.pagamento.valor;
      linha.total_pendente += Math.max(0, fatia_venda - r.pagamento.valor);
      linha.custo_realizado += r.custo_realizado;

      const taxa = calcularTaxa(
        r.pagamento.forma,
        r.pagamento.valor,
        r.pagamento.taxa_valor,
        opts.taxasOverride?.[r.pagamento.forma],
      );
      linha.taxa += taxa;
    }
  }

  const linhas = Array.from(mapa.values()).map((l) => {
    const total_vendido = round2(l.total_vendido);
    const total_recebido = round2(l.total_recebido);
    const total_pendente = round2(l.total_pendente);
    const custo_realizado = round2(l.custo_realizado);
    const taxa = round2(l.taxa);
    const lucro_bruto = round2(total_recebido - custo_realizado);
    const lucro_liquido = round2(lucro_bruto - taxa);
    const ticket_medio = l.qtd_vendas > 0 ? round2(total_vendido / l.qtd_vendas) : 0;
    return {
      ...l,
      total_vendido,
      total_recebido,
      total_pendente,
      custo_realizado,
      taxa,
      lucro_bruto,
      lucro_liquido,
      ticket_medio,
    };
  });

  return linhas;
}
