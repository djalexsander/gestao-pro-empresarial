import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";

export type DashboardData = {
  // KPIs
  vendasMes: number;
  vendasMesAnterior: number;
  comprasMes: number;
  comprasMesAnterior: number;
  lucroMes: number;
  margem: number;
  contasPagar: number;
  qtdContasPagar: number;
  contasReceber: number;
  qtdContasReceber: number;
  estoqueBaixo: number;

  // Séries para gráficos (últimos 6 meses)
  vendasPorMes: Array<{ month: string; vendas: number; compras: number }>;

  // Fluxo de caixa do mês atual (entradas vs saídas por dia)
  fluxoCaixa: Array<{ day: string; entrada: number; saida: number }>;

  // Tabelas
  ultimasVendas: Array<{ id: string; numero: string; cliente: string; valor: number; status: string; data: string }>;
  ultimasCompras: Array<{ id: string; numero: string; fornecedor: string; valor: number; status: string; data: string }>;
};

const MESES_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function inicioDoMes(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function inicioDoMesAnterior(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth() - 1, 1);
}

export function useDashboard() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["dashboard", user?.id],
    enabled: !!user,
    refetchInterval: 60_000,
    queryFn: async (): Promise<DashboardData> => {
      const hoje = new Date();
      const inicioMes = inicioDoMes(hoje);
      const inicioMesAnt = inicioDoMesAnterior(hoje);
      const inicio6Meses = new Date(hoje.getFullYear(), hoje.getMonth() - 5, 1);

      // === Vendas dos últimos 6 meses (finalizadas) ===
      const { data: vendas } = await supabase
        .from("vendas")
        .select("id, numero, total, status, data_emissao, cliente_id")
        .gte("data_emissao", inicio6Meses.toISOString().slice(0, 10))
        .neq("status", "cancelada")
        .order("data_emissao", { ascending: false });

      // === Compras dos últimos 6 meses ===
      const { data: compras } = await supabase
        .from("compras")
        .select("id, numero, total, status, data_emissao, fornecedor_id")
        .gte("data_emissao", inicio6Meses.toISOString().slice(0, 10))
        .order("data_emissao", { ascending: false });

      // === Clientes / Fornecedores para nomes ===
      const clienteIds = [...new Set((vendas ?? []).map((v) => v.cliente_id).filter(Boolean) as string[])];
      const fornecedorIds = [...new Set((compras ?? []).map((c) => c.fornecedor_id).filter(Boolean) as string[])];

      const [clientesRes, fornRes] = await Promise.all([
        clienteIds.length > 0
          ? supabase.from("clientes").select("id, nome").in("id", clienteIds)
          : Promise.resolve({ data: [] as Array<{ id: string; nome: string }> }),
        fornecedorIds.length > 0
          ? supabase.from("fornecedores").select("id, razao_social, nome_fantasia").in("id", fornecedorIds)
          : Promise.resolve({ data: [] as Array<{ id: string; razao_social: string; nome_fantasia: string | null }> }),
      ]);

      const clientesMap = new Map((clientesRes.data ?? []).map((c) => [c.id, c.nome]));
      const fornMap = new Map(
        (fornRes.data ?? []).map((f) => [f.id, f.nome_fantasia || f.razao_social]),
      );

      // === Cálculo dos totais do mês ===
      const vendasMes = (vendas ?? [])
        .filter((v) => new Date(v.data_emissao) >= inicioMes)
        .reduce((s, v) => s + Number(v.total ?? 0), 0);

      const vendasMesAnterior = (vendas ?? [])
        .filter((v) => {
          const d = new Date(v.data_emissao);
          return d >= inicioMesAnt && d < inicioMes;
        })
        .reduce((s, v) => s + Number(v.total ?? 0), 0);

      const comprasMes = (compras ?? [])
        .filter((c) => new Date(c.data_emissao) >= inicioMes)
        .reduce((s, c) => s + Number(c.total ?? 0), 0);

      const comprasMesAnterior = (compras ?? [])
        .filter((c) => {
          const d = new Date(c.data_emissao);
          return d >= inicioMesAnt && d < inicioMes;
        })
        .reduce((s, c) => s + Number(c.total ?? 0), 0);

      // === Custo das mercadorias vendidas no mês (CMV) ===
      const vendasIdsMes = (vendas ?? [])
        .filter((v) => new Date(v.data_emissao) >= inicioMes)
        .map((v) => v.id);

      let custoMes = 0;
      if (vendasIdsMes.length > 0) {
        const { data: itens } = await supabase
          .from("venda_itens")
          .select("quantidade, produto_id")
          .in("venda_id", vendasIdsMes);

        const prodIds = [...new Set((itens ?? []).map((i) => i.produto_id).filter(Boolean) as string[])];
        const custoMap = new Map<string, number>();
        if (prodIds.length > 0) {
          const { data: prods } = await supabase
            .from("produtos")
            .select("id, preco_custo")
            .in("id", prodIds);
          for (const p of prods ?? []) custoMap.set(p.id, Number(p.preco_custo ?? 0));
        }
        custoMes = (itens ?? []).reduce(
          (s, i) => s + Number(i.quantidade ?? 0) * (custoMap.get(i.produto_id) ?? 0),
          0,
        );
      }

      // Lucro bruto = Vendas - Custo dos produtos vendidos
      const lucroMes = vendasMes - custoMes;
      const margem = vendasMes > 0 ? (lucroMes / vendasMes) * 100 : 0;

      // === Séries por mês ===
      const seriesMap = new Map<string, { vendas: number; compras: number }>();
      for (let i = 0; i < 6; i++) {
        const d = new Date(hoje.getFullYear(), hoje.getMonth() - 5 + i, 1);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        seriesMap.set(key, { vendas: 0, compras: 0 });
      }
      for (const v of vendas ?? []) {
        const d = new Date(v.data_emissao);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        const ref = seriesMap.get(key);
        if (ref) ref.vendas += Number(v.total ?? 0);
      }
      for (const c of compras ?? []) {
        const d = new Date(c.data_emissao);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        const ref = seriesMap.get(key);
        if (ref) ref.compras += Number(c.total ?? 0);
      }
      const vendasPorMes = Array.from(seriesMap.entries()).map(([key, val]) => {
        const [, m] = key.split("-").map(Number);
        return { month: MESES_PT[m], vendas: val.vendas, compras: val.compras };
      });

      // === Financeiro: contas a pagar / receber pendentes ===
      const { data: lancamentos } = await supabase
        .from("financeiro_lancamentos")
        .select("id, tipo, valor, valor_pago, status, data_vencimento, data_pagamento");

      const contasPagarLancs = (lancamentos ?? []).filter(
        (l) => l.tipo === "despesa" && l.status !== "pago" && l.status !== "cancelado",
      );
      const contasReceberLancs = (lancamentos ?? []).filter(
        (l) => l.tipo === "receita" && l.status !== "pago" && l.status !== "cancelado",
      );
      const contasPagar = contasPagarLancs.reduce(
        (s, l) => s + (Number(l.valor) - Number(l.valor_pago ?? 0)),
        0,
      );
      const contasReceber = contasReceberLancs.reduce(
        (s, l) => s + (Number(l.valor) - Number(l.valor_pago ?? 0)),
        0,
      );

      // === Fluxo de caixa do mês (pagamentos efetivados) ===
      const fluxoMap = new Map<number, { entrada: number; saida: number }>();
      const diasNoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
      for (let d = 1; d <= diasNoMes; d++) fluxoMap.set(d, { entrada: 0, saida: 0 });

      for (const l of lancamentos ?? []) {
        if (!l.data_pagamento) continue;
        const dp = new Date(l.data_pagamento);
        if (dp < inicioMes) continue;
        const dia = dp.getDate();
        const ref = fluxoMap.get(dia);
        if (!ref) continue;
        if (l.tipo === "receita") ref.entrada += Number(l.valor_pago ?? 0);
        else if (l.tipo === "despesa") ref.saida += Number(l.valor_pago ?? 0);
      }
      const fluxoCaixa = Array.from(fluxoMap.entries()).map(([dia, val]) => ({
        day: String(dia).padStart(2, "0"),
        entrada: val.entrada,
        saida: val.saida,
      }));

      // === Estoque baixo ===
      const { data: produtos } = await supabase
        .from("produtos")
        .select("id, estoque_minimo")
        .eq("status", "ativo")
        .gt("estoque_minimo", 0);

      let estoqueBaixo = 0;
      if (produtos && produtos.length > 0) {
        const { data: movs } = await supabase
          .from("estoque_movimentacoes")
          .select("produto_id, tipo, quantidade");
        const saldos = new Map<string, number>();
        for (const m of movs ?? []) {
          const sinal =
            m.tipo === "entrada" || m.tipo === "devolucao"
              ? 1
              : m.tipo === "saida" || m.tipo === "transferencia"
                ? -1
                : 1;
          saldos.set(m.produto_id, (saldos.get(m.produto_id) ?? 0) + sinal * Number(m.quantidade));
        }
        for (const p of produtos) {
          const saldo = saldos.get(p.id) ?? 0;
          if (saldo <= Number(p.estoque_minimo)) estoqueBaixo++;
        }
      }

      // === Últimas vendas e compras ===
      const ultimasVendas = (vendas ?? []).slice(0, 5).map((v) => ({
        id: v.id,
        numero: v.numero,
        cliente: v.cliente_id ? (clientesMap.get(v.cliente_id) ?? "—") : "Consumidor",
        valor: Number(v.total ?? 0),
        status: v.status,
        data: v.data_emissao,
      }));
      const ultimasCompras = (compras ?? []).slice(0, 5).map((c) => ({
        id: c.id,
        numero: c.numero,
        fornecedor: c.fornecedor_id ? (fornMap.get(c.fornecedor_id) ?? "—") : "—",
        valor: Number(c.total ?? 0),
        status: c.status,
        data: c.data_emissao,
      }));

      return {
        vendasMes,
        vendasMesAnterior,
        comprasMes,
        comprasMesAnterior,
        lucroMes,
        margem,
        contasPagar,
        qtdContasPagar: contasPagarLancs.length,
        contasReceber,
        qtdContasReceber: contasReceberLancs.length,
        estoqueBaixo,
        vendasPorMes,
        fluxoCaixa,
        ultimasVendas,
        ultimasCompras,
      };
    },
  });
}
