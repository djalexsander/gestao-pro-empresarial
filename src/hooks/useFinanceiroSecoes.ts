import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { computePeriodo, type PeriodoRange } from "@/lib/dateRange";
import type { SecaoFiltroValue, FormaFiltro } from "@/components/financeiro/SecaoFiltro";
import {
  calcAbertoLanc,
  calcValorRealizado,
  calcSaldoProjetado,
  isLancCancelado,
  isLancPagar,
  isLancRealizado,
  isLancReceber,
} from "@/lib/financeiro-canonico";
import {
  montarRecebimentosDetalhados,
  totalizarRecebimentos,
  type LancamentoRecebidoFonte,
  type PagamentoRecebidoFonte,
  type RecebimentoDetalhe,
  type VendaRecebidaFonte,
} from "@/lib/financeiro-recebimentos";
// Local desktop finance helpers are intentionally not used for cloud-only reports.

function toRange(v: SecaoFiltroValue): PeriodoRange {
  return computePeriodo(v.preset, v.custom);
}

// ============ Posição financeira (a receber / a pagar / saldo) ============

export interface PosicaoFinanceiraData {
  totalReceber: number;
  qtdReceber: number;
  totalPagar: number;
  qtdPagar: number;
  saldo: number;
  caixaRealizadoPeriodo: number;
  periodo: PeriodoRange;
}

export function usePosicaoFinanceira(filtro: SecaoFiltroValue) {
  const periodo = toRange(filtro);
  return useQuery({
    queryKey: ["fin_posicao_carteira_atual", periodo.inicio, periodo.fim],
    staleTime: 30_000,
    queryFn: async (): Promise<PosicaoFinanceiraData> => {
      const { data, error } = await supabase
        .from("financeiro_lancamentos")
        .select("id, tipo, valor, valor_pago, status, data_vencimento, conciliado_em")
        .limit(5000);
      if (error) throw error;

      let totalReceber = 0;
      let qtdReceber = 0;
      let totalPagar = 0;
      let qtdPagar = 0;
      for (const l of (data ?? []) as Array<{
        tipo: string;
        valor: number;
        valor_pago: number | null;
        status: string;
        conciliado_em: string | null;
      }>) {
        if (isLancCancelado(l) || isLancRealizado(l)) continue;
        const aberto = calcAbertoLanc(l);
        if (aberto <= 0) continue;
        if (isLancReceber(l)) {
          if (l.conciliado_em) continue;
          totalReceber += aberto;
          qtdReceber += 1;
        } else if (isLancPagar(l)) {
          totalPagar += aberto;
          qtdPagar += 1;
        }
      }
      const { data: pagamentos, error: pagamentosError } = await supabase
        .from("lancamento_pagamentos")
        .select("lancamento_id, valor, data_pagamento, lancamento:financeiro_lancamentos(tipo)")
        .gte("data_pagamento", periodo.inicio)
        .lte("data_pagamento", periodo.fim)
        .limit(10000);
      if (pagamentosError) throw pagamentosError;
      let caixaRealizadoPeriodo = (pagamentos ?? []).reduce((total, pagamento) => {
        const tipo = (pagamento.lancamento as { tipo?: string } | null)?.tipo;
        const valor = Number(pagamento.valor) || 0;
        return total + (tipo === "pagar" || tipo === "despesa" ? -valor : valor);
      }, 0);
      const idsComBaixa = new Set((pagamentos ?? []).map((p) => p.lancamento_id));
      const { data: realizadosSemHistorico } = await supabase
        .from("financeiro_lancamentos")
        .select("id, tipo, valor, valor_pago")
        .in("status", ["pago", "recebido"])
        .gte("data_pagamento", periodo.inicio)
        .lte("data_pagamento", periodo.fim)
        .limit(5000);
      for (const lancamento of realizadosSemHistorico ?? []) {
        if (idsComBaixa.has(lancamento.id)) continue;
        const valor = calcValorRealizado(lancamento);
        caixaRealizadoPeriodo += isLancPagar(lancamento) ? -valor : valor;
      }
      return {
        totalReceber,
        qtdReceber,
        totalPagar,
        qtdPagar,
        saldo: calcSaldoProjetado(caixaRealizadoPeriodo, totalReceber, totalPagar),
        caixaRealizadoPeriodo,
        periodo,
      };
    },
  });
}

// ============ Performance (vendido / custo / lucro) ============

export interface PerformanceData {
  indisponivel?: boolean;
  indisponivelMotivo?: string;
  totalVendido: number;
  qtdVendas: number;
  custoTotal: number;
  qtdItens: number;
  qtdItensSemCusto: number;
  lucroBruto: number;
  margemPct: number;
  periodo: PeriodoRange;
}

function periodoMs(periodo: PeriodoRange) {
  return {
    desde_ms: new Date(`${periodo.inicio}T00:00:00`).getTime(),
    ate_ms: new Date(`${periodo.fim}T23:59:59.999`).getTime(),
  };
}

// local helpers removed; use Supabase as canonical source for reports

export function usePerformancePeriodo(filtro: SecaoFiltroValue) {
  const periodo = toRange(filtro);
  return useQuery({
    queryKey: ["fin_performance", periodo.inicio, periodo.fim],
    staleTime: 30_000,
    queryFn: async (): Promise<PerformanceData> => {
      const { data: vendasData, error } = await supabase
        .from("vendas")
        .select("id, total")
        .gte("data_finalizacao", periodo.inicioTs)
        .lte("data_finalizacao", periodo.fimTs)
        .neq("status", "cancelada")
        .limit(5000);
      if (error) throw error;

      const vendas = (vendasData ?? []) as Array<{ id: string; total: number }>;
      const totalVendido = vendas.reduce((s, v) => s + (Number(v.total) || 0), 0);

      let custoTotal = 0;
      let qtdItens = 0;
      let qtdItensSemCusto = 0;
      const ids = vendas.map((v) => v.id);
      if (ids.length > 0) {
        const { data: itens } = await supabase
          .from("venda_itens")
          .select("quantidade, total, produto:produtos(preco_custo)")
          .in("venda_id", ids)
          .limit(20000);
        for (const it of (itens ?? []) as Array<{
          quantidade: number;
          total: number;
          produto: { preco_custo: number | null } | null;
        }>) {
          const qtd = Number(it.quantidade) || 0;
          const pc = Number(it.produto?.preco_custo ?? 0) || 0;
          qtdItens += 1;
          if (pc <= 0) qtdItensSemCusto += 1;
          custoTotal += pc * qtd;
        }
      }
      const lucroBruto = totalVendido - custoTotal;
      const margemPct = totalVendido > 0 ? (lucroBruto / totalVendido) * 100 : 0;
      return {
        totalVendido,
        qtdVendas: vendas.length,
        custoTotal,
        qtdItens,
        qtdItensSemCusto,
        lucroBruto,
        margemPct,
        periodo,
      };
    },
  });
}

// ============ A receber por origem e operacional ============

export interface ReceberOrigemData {
  fiadoEmAberto: number;
  qtdFiado: number;
  recebidoPeriodo: number;
  qtdRecebimentos: number;
  vencidosTotal: number;
  qtdVencidos: number;
  recebimentos: RecebimentoDetalhe[];
  periodo: PeriodoRange;
  forma: FormaFiltro;
}

function matchForma(formaFiltro: FormaFiltro, lanc: string | null): boolean {
  if (formaFiltro === "todos") return true;
  return lanc === formaFiltro;
}

export function useReceberOrigem(filtro: SecaoFiltroValue) {
  const periodo = toRange(filtro);
  const forma: FormaFiltro = filtro.forma ?? "todos";
  return useQuery({
    queryKey: ["fin_receber_origem", periodo.inicio, periodo.fim, forma],
    staleTime: 30_000,
    queryFn: async (): Promise<ReceberOrigemData> => {
      const { data: abertos } = await supabase
        .from("financeiro_lancamentos")
        .select("valor, valor_pago, forma_pagamento, conciliado_em, status, tipo")
        .in("tipo", ["receber", "receita"])
        .limit(5000);

      let fiadoEmAberto = 0;
      let qtdFiado = 0;
      for (const l of (abertos ?? []) as Array<{
        valor: number;
        valor_pago: number | null;
        forma_pagamento: string | null;
        conciliado_em: string | null;
        status: string;
        tipo: string;
      }>) {
        if (isLancCancelado(l) || isLancRealizado(l)) continue;
        if (l.conciliado_em) continue;
        if (!matchForma(forma, l.forma_pagamento)) continue;
        const aberto = calcAbertoLanc(l);
        if (aberto <= 0) continue;
        if (l.forma_pagamento === "fiado") {
          fiadoEmAberto += aberto;
          qtdFiado += 1;
        }
      }

      // Recebido no período: cada baixa individual, inclusive parcial.
      const { data: pagosData, error: pagosError } = await supabase
        .from("lancamento_pagamentos")
        .select(
          "id, lancamento_id, valor, data_pagamento, created_at, forma_pagamento, observacao, registrado_por",
        )
        .gte("data_pagamento", periodo.inicio)
        .lte("data_pagamento", periodo.fim)
        .limit(10000);
      if (pagosError) throw pagosError;

      const pagos = (pagosData ?? []) as PagamentoRecebidoFonte[];
      const lancamentoIds = [
        ...new Set(pagos.map((pagamento) => pagamento.lancamento_id)),
      ];
      const { data: lancamentosComBaixa, error: lancamentosComBaixaError } =
        lancamentoIds.length
          ? await supabase
              .from("financeiro_lancamentos")
              .select(
                "id, tipo, descricao, valor, valor_pago, data_pagamento, created_at, forma_pagamento, observacoes, status, venda_id, cliente_id, parcela_numero, parcela_total",
              )
              .in("id", lancamentoIds)
          : { data: [], error: null };
      if (lancamentosComBaixaError) throw lancamentosComBaixaError;

      const { data: recebidosSemHistorico, error: recebidosError } = await supabase
        .from("financeiro_lancamentos")
        .select(
          "id, tipo, descricao, valor, valor_pago, data_pagamento, created_at, forma_pagamento, observacoes, status, venda_id, cliente_id, parcela_numero, parcela_total",
        )
        .in("tipo", ["receber", "receita"])
        .in("status", ["pago", "recebido"])
        .gte("data_pagamento", periodo.inicio)
        .lte("data_pagamento", periodo.fim)
        .limit(5000);
      if (recebidosError) throw recebidosError;

      const lancamentosMap = new Map<string, LancamentoRecebidoFonte>();
      for (const lancamento of [
        ...(lancamentosComBaixa ?? []),
        ...(recebidosSemHistorico ?? []),
      ] as LancamentoRecebidoFonte[]) {
        lancamentosMap.set(lancamento.id, lancamento);
      }
      const lancamentosRecebidos = Array.from(lancamentosMap.values());
      const vendaIds = [
        ...new Set(
          lancamentosRecebidos
            .map((lancamento) => lancamento.venda_id)
            .filter(Boolean),
        ),
      ] as string[];
      const { data: vendasData, error: vendasError } = vendaIds.length
        ? await supabase
            .from("vendas")
            .select(
              "id, numero, data_finalizacao, operador_id, terminal_id, cliente_id",
            )
            .in("id", vendaIds)
        : { data: [], error: null };
      if (vendasError) throw vendasError;
      const vendas = (vendasData ?? []) as VendaRecebidaFonte[];

      const clienteIds = [
        ...new Set(
          [
            ...lancamentosRecebidos.map((item) => item.cliente_id),
            ...vendas.map((item) => item.cliente_id),
          ].filter(Boolean),
        ),
      ] as string[];
      const operadorIds = [
        ...new Set(vendas.map((item) => item.operador_id).filter(Boolean)),
      ] as string[];
      const terminalIds = [
        ...new Set(vendas.map((item) => item.terminal_id).filter(Boolean)),
      ] as string[];
      const [
        { data: clientesData, error: clientesError },
        { data: operadoresData, error: operadoresError },
        { data: terminaisData, error: terminaisError },
      ] = await Promise.all([
        clienteIds.length
          ? supabase
              .from("clientes")
              .select("id, nome, nome_fantasia")
              .in("id", clienteIds)
          : Promise.resolve({ data: [], error: null }),
        operadorIds.length
          ? supabase
              .from("funcionarios")
              .select("id, nome")
              .in("id", operadorIds)
          : Promise.resolve({ data: [], error: null }),
        terminalIds.length
          ? supabase
              .from("terminais")
              .select("id, nome")
              .in("id", terminalIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (clientesError) throw clientesError;
      if (operadoresError) throw operadoresError;
      if (terminaisError) throw terminaisError;

      const recebimentos = montarRecebimentosDetalhados({
        pagamentos: pagos,
        lancamentos: lancamentosRecebidos,
        vendas,
        clientes: new Map(
          (clientesData ?? []).map((cliente) => [
            cliente.id,
            cliente.nome_fantasia || cliente.nome,
          ]),
        ),
        operadores: new Map(
          (operadoresData ?? []).map((operador) => [
            operador.id,
            operador.nome,
          ]),
        ),
        terminais: new Map(
          (terminaisData ?? []).map((terminal) => [terminal.id, terminal.nome]),
        ),
      }).filter((recebimento) =>
        matchForma(forma, recebimento.forma_pagamento),
      );
      const recebido = totalizarRecebimentos(recebimentos);
      const recebidoPeriodo = recebido.valor;
      const qtdRecebimentos = recebido.quantidade;

      // Vencidos (a receber, vencimento dentro do período escolhido)
      const hoje = new Date().toISOString().slice(0, 10);
      const { data: vencidos } = await supabase
        .from("financeiro_lancamentos")
        .select("valor, valor_pago, forma_pagamento, tipo, status")
        .in("tipo", ["receber", "receita"])
        .in("status", ["pendente", "parcial", "vencido"])
        .gte("data_vencimento", periodo.inicio)
        .lte("data_vencimento", periodo.fim < hoje ? periodo.fim : hoje)
        .lt("data_vencimento", hoje)
        .limit(5000);

      let vencidosTotal = 0;
      let qtdVencidos = 0;
      for (const l of (vencidos ?? []) as Array<{
        valor: number;
        valor_pago: number | null;
        forma_pagamento: string | null;
        tipo: string;
        status: string;
      }>) {
        if (!matchForma(forma, l.forma_pagamento)) continue;
        const aberto = calcAbertoLanc(l);
        if (aberto > 0) {
          vencidosTotal += aberto;
          qtdVencidos += 1;
        }
      }

      return {
        fiadoEmAberto,
        qtdFiado,
        recebidoPeriodo,
        qtdRecebimentos,
        vencidosTotal,
        qtdVencidos,
        recebimentos,
        periodo,
        forma,
      };
    },
  });
}
