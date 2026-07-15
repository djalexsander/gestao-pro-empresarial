import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  calcLucroBruto,
  calcMargemPct,
  calcAbertoLanc,
  calcValorRealizado,
} from "@/lib/financeiro-canonico";
// Local desktop finance helpers are intentionally not used for cloud-only reports.

export interface FinanceiroPeriodo {
  inicio: string; // YYYY-MM-DD
  fim: string;
  inicioTs: string;
  fimTs: string;
  hoje: string;
}

export function getMesAtual(): FinanceiroPeriodo {
  const today = new Date();
  const inicio = new Date(today.getFullYear(), today.getMonth(), 1);
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const inicioStr = ymd(inicio);
  const fimStr = ymd(today);
  return {
    inicio: inicioStr,
    fim: fimStr,
    inicioTs: `${inicioStr}T00:00:00`,
    fimTs: `${fimStr}T23:59:59.999`,
    hoje: fimStr,
  };
}

export interface VendaItemDetalhe {
  venda_id: string;
  venda_numero: string;
  data: string;
  produto_id: string;
  produto_nome: string;
  quantidade: number;
  preco_unitario: number;
  preco_custo: number;
  total_venda: number;
  total_custo: number;
  lucro: number;
  sem_custo: boolean;
}

export interface VendaResumoDetalhe {
  id: string;
  numero: string;
  data: string;
  cliente_nome: string | null;
  forma_pagamento: string | null;
  status_pagamento: string;
  total: number;
}

export interface FinanceiroIndicadores {
  custoIndisponivel?: boolean;
  custoIndisponivelMotivo?: string;
  periodo: FinanceiroPeriodo;
  totalVendido: number;
  custoTotal: number;
  lucroBruto: number;
  margemPct: number;
  qtdVendas: number;
  qtdItensSemCusto: number;
  qtdItens: number;
  fiadoEmAberto: number;
  qtdFiado: number;
  ifoodAReceber: number;
  qtdIfood: number;
  recebidoHoje: number;
  recebidoPeriodo: number;
  totalEmAberto: number;
  qtdRecebimentosHoje: number;
  vencidosTotal: number;
  qtdVencidos: number;
  itensDetalhe: VendaItemDetalhe[];
  vendasDetalhe: VendaResumoDetalhe[];
}

interface LocalVendaResumo {
  id: string;
  numero: string;
  data_finalizacao: string | null;
  data_emissao: string;
  total: number;
  status: string;
  status_pagamento: string;
  forma_pagamento: string | null;
  cliente_nome?: string | null;
}

export function useFinanceiroIndicadores() {
  return useQuery({
    queryKey: ["financeiro_indicadores_mes"],
    queryFn: async (): Promise<FinanceiroIndicadores> => {
      const periodo = getMesAtual();
      
      const hojeStr = periodo.hoje;

      // 1) Vendas finalizadas no mês
      const { data: vendasData, error: errVendas } = await supabase
        .from("vendas")
        .select(
          "id, numero, data_finalizacao, total, forma_pagamento, status_pagamento, cliente:clientes(nome)",
        )
        .gte("data_finalizacao", periodo.inicioTs)
        .lte("data_finalizacao", periodo.fimTs)
        .neq("status", "cancelada")
        .limit(5000);
      if (errVendas) throw errVendas;

      const vendas = (vendasData ?? []) as Array<{
        id: string;
        numero: string;
        data_finalizacao: string;
        total: number;
        forma_pagamento: string | null;
        status_pagamento: string;
        cliente: { nome: string | null } | null;
      }>;

      const vendaIds = vendas.map((v) => v.id);

      // 2) Itens dessas vendas + custo cadastrado dos produtos
      let itens: VendaItemDetalhe[] = [];
      let custoTotal = 0;
      let qtdItens = 0;
      let qtdItensSemCusto = 0;

      if (vendaIds.length > 0) {
        const { data: itensData, error: errItens } = await supabase
          .from("venda_itens")
          .select(
            "venda_id, produto_id, quantidade, preco_unitario, total, produto:produtos(nome, preco_custo)",
          )
          .in("venda_id", vendaIds)
          .limit(20000);
        if (errItens) throw errItens;

        const vendaMap = new Map(vendas.map((v) => [v.id, v] as const));

        itens = (
          (itensData ?? []) as Array<{
            venda_id: string;
            produto_id: string;
            quantidade: number;
            preco_unitario: number;
            total: number;
            produto: { nome: string | null; preco_custo: number | null } | null;
          }>
        ).map((it) => {
          const v = vendaMap.get(it.venda_id);
          const qtd = Number(it.quantidade) || 0;
          const precoCusto = Number(it.produto?.preco_custo ?? 0) || 0;
          const totalVenda = Number(it.total) || 0;
          const totalCusto = precoCusto * qtd;
          const semCusto = precoCusto <= 0;
          qtdItens += 1;
          if (semCusto) qtdItensSemCusto += 1;
          custoTotal += totalCusto;
          return {
            venda_id: it.venda_id,
            venda_numero: v?.numero ?? "—",
            data: v?.data_finalizacao ?? "",
            produto_id: it.produto_id,
            produto_nome: it.produto?.nome ?? "Produto",
            quantidade: qtd,
            preco_unitario: Number(it.preco_unitario) || 0,
            preco_custo: precoCusto,
            total_venda: totalVenda,
            total_custo: totalCusto,
            lucro: totalVenda - totalCusto,
            sem_custo: semCusto,
          };
        });
      }

      const totalVendido = vendas.reduce((s, v) => s + (Number(v.total) || 0), 0);
      const lucroBruto = calcLucroBruto(totalVendido, custoTotal);
      const margemPct = calcMargemPct(totalVendido, lucroBruto);

      // 3) Fiado e iFood em aberto (do financeiro_lancamentos a receber)
      const { data: lancsAR } = await supabase
        .from("financeiro_lancamentos")
        .select("id, valor, valor_pago, forma_pagamento, status, conciliado_em")
        .eq("tipo", "receber")
        .in("status", ["pendente", "parcial", "vencido"])
        .limit(5000);

      let fiadoEmAberto = 0;
      let qtdFiado = 0;
      let ifoodAReceber = 0;
      let qtdIfood = 0;

      for (const l of (lancsAR ?? []) as Array<{
        id: string;
        valor: number;
        valor_pago: number | null;
        forma_pagamento: string | null;
        status: string;
        conciliado_em: string | null;
      }>) {
        // Canônico: ignora conciliados; usa valor em aberto (nunca negativo).
        if (l.conciliado_em) continue;
        const aberto = calcAbertoLanc(l);
        if (aberto <= 0) continue;
        if (l.forma_pagamento === "fiado") {
          fiadoEmAberto += aberto;
          qtdFiado += 1;
        } else if (l.forma_pagamento === "ifood") {
          ifoodAReceber += aberto;
          qtdIfood += 1;
        }
      }

      // 4) Recebido hoje/no mês: baixas efetivas, inclusive parciais.
      const { data: pagosHoje } = await supabase
        .from("lancamento_pagamentos")
        .select("id, lancamento_id, valor, lancamento:financeiro_lancamentos(tipo)")
        .eq("data_pagamento", hojeStr)
        .limit(2000);

      const pagamentosReceberHoje = (pagosHoje ?? []).filter((p) => {
        const tipo = (p.lancamento as { tipo?: string } | null)?.tipo;
        return tipo === "receber" || tipo === "receita";
      });
      const recebidoHoje = pagamentosReceberHoje.reduce((s, p) => s + (Number(p.valor) || 0), 0);
      let qtdRecebimentosHoje = pagamentosReceberHoje.length;

      const idsComBaixaHoje = new Set(pagamentosReceberHoje.map((p) => p.lancamento_id));
      const { data: recebidosHojeSemHistorico } = await supabase
        .from("financeiro_lancamentos")
        .select("id, valor, valor_pago")
        .eq("tipo", "receber")
        .in("status", ["pago", "recebido"])
        .eq("data_pagamento", hojeStr)
        .limit(5000);
      const recebidoImediatoHoje = (recebidosHojeSemHistorico ?? []).reduce((s, l) => {
        if (idsComBaixaHoje.has(l.id)) return s;
        qtdRecebimentosHoje += 1;
        return s + calcValorRealizado(l);
      }, 0);

      const { data: pagosPeriodo } = await supabase
        .from("lancamento_pagamentos")
        .select("lancamento_id, valor, lancamento:financeiro_lancamentos(tipo)")
        .gte("data_pagamento", periodo.inicio)
        .lte("data_pagamento", periodo.fim)
        .limit(10000);
      let recebidoPeriodo = (pagosPeriodo ?? []).reduce((s, p) => {
        const tipo = (p.lancamento as { tipo?: string } | null)?.tipo;
        return tipo === "receber" || tipo === "receita" ? s + (Number(p.valor) || 0) : s;
      }, 0);
      const idsComBaixaPeriodo = new Set((pagosPeriodo ?? []).map((p) => p.lancamento_id));
      const { data: recebidosPeriodoSemHistorico } = await supabase
        .from("financeiro_lancamentos")
        .select("id, valor, valor_pago")
        .eq("tipo", "receber")
        .in("status", ["pago", "recebido"])
        .gte("data_pagamento", periodo.inicio)
        .lte("data_pagamento", periodo.fim)
        .limit(5000);
      recebidoPeriodo += (recebidosPeriodoSemHistorico ?? []).reduce(
        (s, l) => idsComBaixaPeriodo.has(l.id) ? s : s + calcValorRealizado(l),
        0,
      );
      const totalEmAberto = fiadoEmAberto + ifoodAReceber;

      // 5) Vencidos (a receber + a pagar)
      const { data: vencidos } = await supabase
        .from("financeiro_lancamentos")
        .select("id, valor, valor_pago, tipo")
        .in("status", ["pendente", "parcial", "vencido"])
        .lt("data_vencimento", hojeStr)
        .limit(5000);

      let vencidosTotal = 0;
      let qtdVencidos = 0;
      for (const l of (vencidos ?? []) as Array<{
        valor: number;
        valor_pago: number | null;
      }>) {
        const aberto = (Number(l.valor) || 0) - (Number(l.valor_pago) || 0);
        if (aberto > 0) {
          vencidosTotal += aberto;
          qtdVencidos += 1;
        }
      }

      const vendasDetalhe: VendaResumoDetalhe[] = vendas.map((v) => ({
        id: v.id,
        numero: v.numero,
        data: v.data_finalizacao,
        cliente_nome: v.cliente?.nome ?? null,
        forma_pagamento: v.forma_pagamento,
        status_pagamento: v.status_pagamento,
        total: Number(v.total) || 0,
      }));

      return {
        periodo,
        totalVendido,
        custoTotal,
        lucroBruto,
        margemPct,
        qtdVendas: vendas.length,
        qtdItensSemCusto,
        qtdItens,
        fiadoEmAberto,
        qtdFiado,
        ifoodAReceber,
        qtdIfood,
        recebidoHoje: recebidoHoje + recebidoImediatoHoje,
        recebidoPeriodo,
        totalEmAberto,
        qtdRecebimentosHoje,
        vencidosTotal,
        qtdVencidos,
        itensDetalhe: itens,
        vendasDetalhe,
      };
    },
    staleTime: 30_000,
  });
}
