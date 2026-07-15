import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { getDesktopConfig } from "@/integrations/desktop/configStore";
import {
  isLancPagar,
  isLancReceber,
  isLancRealizado,
} from "@/lib/financeiro-canonico";
import { fetchDashboardFinanceiroKpi } from "@/lib/dashboard-financeiro-kpis";
import { fetchDashboardLucroBruto } from "@/lib/dashboard-lucro-bruto";

export type DashboardData = {
  indisponivel?: boolean;
  indisponivelMotivo?: string;

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
const LOCAL_DASHBOARD_TIMEOUT_MS = 2500;

const EMPTY_DASHBOARD: DashboardData = {
  indisponivel: false,
  vendasMes: 0,
  vendasMesAnterior: 0,
  comprasMes: 0,
  comprasMesAnterior: 0,
  lucroMes: 0,
  margem: 0,
  contasPagar: 0,
  qtdContasPagar: 0,
  contasReceber: 0,
  qtdContasReceber: 0,
  estoqueBaixo: 0,
  vendasPorMes: [],
  fluxoCaixa: [],
  ultimasVendas: [],
  ultimasCompras: [],
};

interface LocalVendaRow {
  id: string;
  numero: string;
  cliente_id: string | null;
  cliente_nome?: string | null;
  data_emissao: string;
  data_finalizacao: string | null;
  total: number;
  status: string;
}

interface LocalProdutoRow {
  id: string;
  status?: string | null;
  estoque_minimo?: number | null;
}

interface LocalEstoqueSaldoRow {
  produto_id: string;
  tipo: string;
  quantidade: number;
}

interface LocalFinanceiroRow {
  tipo?: string | null;
  valor: number;
  status?: string | null;
  data_pagamento_ms?: number | null;
  data_vencimento_ms?: number | null;
  cancelado_em_ms?: number | null;
}

function dashboardIndisponivel(motivo: string): DashboardData {
  return {
    ...EMPTY_DASHBOARD,
    indisponivel: true,
    indisponivelMotivo: motivo,
  };
}

function inicioDoMes(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function inicioDoMesAnterior(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth() - 1, 1);
}
function dataLocalYmd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function useDashboard() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["dashboard", user?.id],
    enabled: !!user,
    refetchInterval: 60_000,
    placeholderData: EMPTY_DASHBOARD,
    retry: 1,
    queryFn: async (): Promise<DashboardData> => {
      const load = async (): Promise<DashboardData> => {
      const hoje = new Date();
      const inicioMes = inicioDoMes(hoje);
      const inicioMesAnt = inicioDoMesAnterior(hoje);
      const inicio6Meses = new Date(hoje.getFullYear(), hoje.getMonth() - 5, 1);
      const fimHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 23, 59, 59, 999);

      // === Vendas dos últimos 6 meses (finalizadas) ===
      // Canônico: usar data_finalizacao (mesma base do Financeiro/Relatórios).
      const { data: vendas } = await supabase
        .from("vendas")
        .select("id, numero, total, status, data_finalizacao, data_emissao, cliente_id")
        .gte("data_finalizacao", inicio6Meses.toISOString())
        .neq("status", "cancelada")
        .order("data_finalizacao", { ascending: false });

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

      // === Cálculo dos totais do mês (canônico: data_finalizacao) ===
      const dataVenda = (v: { data_finalizacao: string | null; data_emissao: string }) =>
        new Date(v.data_finalizacao ?? v.data_emissao);

      const vendasMes = (vendas ?? [])
        .filter((v) => dataVenda(v) >= inicioMes)
        .reduce((s, v) => s + Number(v.total ?? 0), 0);

      const vendasMesAnterior = (vendas ?? [])
        .filter((v) => {
          const d = dataVenda(v);
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
      // Hoje usa produtos.preco_custo; quando venda_itens passar a persistir
      // custo no momento da venda, esse valor deve ter preferência.
      // Canônico: lucro bruto e margem
      const lucroBrutoMes = await fetchDashboardLucroBruto(
        inicioMes.toISOString(),
        fimHoje.toISOString(),
      );
      const lucroMes = lucroBrutoMes.lucro;
      const margem = lucroBrutoMes.margem;

      // === Séries por mês ===
      const seriesMap = new Map<string, { vendas: number; compras: number }>();
      for (let i = 0; i < 6; i++) {
        const d = new Date(hoje.getFullYear(), hoje.getMonth() - 5 + i, 1);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        seriesMap.set(key, { vendas: 0, compras: 0 });
      }
      for (const v of vendas ?? []) {
        const d = dataVenda(v);
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

      // === Financeiro: contas a pagar / receber pendentes (canônico) ===
      const { data: lancamentos } = await supabase
        .from("financeiro_lancamentos")
        .select("id, tipo, valor, valor_pago, status, data_vencimento, data_pagamento, conciliado_em");
      const { data: pagamentosFinanceiros } = await supabase
        .from("lancamento_pagamentos")
        .select("lancamento_id, valor, data_pagamento, lancamento:financeiro_lancamentos(tipo)")
        .gte("data_pagamento", dataLocalYmd(inicioMes))
        .lte("data_pagamento", dataLocalYmd(hoje))
        .limit(10000);

      const [contasPagarKpi, contasReceberKpi] = await Promise.all([
        fetchDashboardFinanceiroKpi("pagar"),
        fetchDashboardFinanceiroKpi("receber"),
      ]);

      // === Fluxo de caixa do mês (somente pagamentos realizados) ===
      const fluxoMap = new Map<number, { entrada: number; saida: number }>();
      const diasNoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
      for (let d = 1; d <= diasNoMes; d++) fluxoMap.set(d, { entrada: 0, saida: 0 });

      const lancamentosComHistorico = new Set<string>();
      for (const pagamento of pagamentosFinanceiros ?? []) {
        lancamentosComHistorico.add(pagamento.lancamento_id);
        const dp = new Date(`${pagamento.data_pagamento}T00:00:00`);
        const ref = fluxoMap.get(dp.getDate());
        if (!ref) continue;
        const valor = Number(pagamento.valor) || 0;
        const tipo = (pagamento.lancamento as { tipo?: string } | null)?.tipo;
        if (tipo === "receber" || tipo === "receita") ref.entrada += valor;
        else if (tipo === "pagar" || tipo === "despesa") ref.saida += valor;
      }

      // Compatibilidade: recebimentos imediatos criados já quitados podem não
      // possuir linha histórica em lancamento_pagamentos.
      for (const l of lancamentos ?? []) {
        if (lancamentosComHistorico.has(l.id)) continue;
        if (!l.data_pagamento) continue;
        if (!isLancRealizado(l)) continue; // ignora pendente/cancelado
        const dp = new Date(l.data_pagamento);
        if (dp < inicioMes) continue;
        const dia = dp.getDate();
        const ref = fluxoMap.get(dia);
        if (!ref) continue;
        const valor = Number(l.valor_pago ?? l.valor) || 0;
        if (isLancReceber(l)) ref.entrada += valor;
        else if (isLancPagar(l)) ref.saida += valor;
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
        data: v.data_finalizacao ?? v.data_emissao,
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
        contasPagar: contasPagarKpi.total,
        qtdContasPagar: contasPagarKpi.quantidade,
        contasReceber: contasReceberKpi.total,
        qtdContasReceber: contasReceberKpi.quantidade,
        estoqueBaixo,
        vendasPorMes,
        fluxoCaixa,
        ultimasVendas,
        ultimasCompras,
      };
      };

      try {
        return await load();
      } catch {
        return dashboardIndisponivel(
          "Este módulo precisa de internet. O PDV continua funcionando offline.",
        );
      }
    },
  });
}
