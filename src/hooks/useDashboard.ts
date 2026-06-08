import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { getDataMode, isDesktop } from "@/integrations/data/mode";
import { getDesktopConfig } from "@/integrations/desktop/configStore";
import { getBaseUrl } from "@/integrations/desktop/serverConnection";
import {
  calcAbertoLanc,
  calcLucroBruto,
  calcMargemPct,
  isLancPagar,
  isLancReceber,
  isLancRealizado,
  isLancCancelado,
} from "@/lib/financeiro-canonico";

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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Dashboard demorou para responder."));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function getLocalDashboardBaseUrl(): string | null {
  const cfg = getDesktopConfig();
  if (cfg.role === "server") {
    const porta = cfg.terminal?.porta ?? 3333;
    return `http://127.0.0.1:${porta}`;
  }
  return getBaseUrl(cfg.terminal);
}

async function fetchLocalDashboardJson<T>(
  baseUrl: string,
  path: string,
  query?: Record<string, string | undefined>,
): Promise<T> {
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value != null && value !== "") url.searchParams.set(key, value);
  }
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await res.text());
  const json = (await res.json()) as { data?: T } | T;
  return json && typeof json === "object" && "data" in json
    ? (json as { data: T }).data
    : (json as T);
}

function localFinanceiroAsCanonico(l: LocalFinanceiroRow) {
  return {
    ...l,
    tipo: l.tipo === "entrada" ? "receber" : l.tipo === "saida" ? "pagar" : l.tipo,
    status: l.cancelado_em_ms ? "cancelado" : (l.status ?? "pago"),
    data_pagamento: l.data_pagamento_ms ? new Date(l.data_pagamento_ms).toISOString() : null,
    data_vencimento: l.data_vencimento_ms ? new Date(l.data_vencimento_ms).toISOString() : null,
    valor_pago: l.status === "pendente" ? 0 : l.valor,
  };
}

function isLocalDesktopMode() {
  if (!isDesktop()) return false;
  const mode = getDataMode();
  return mode === "local-server" || mode === "local-terminal";
}

function inicioDoMes(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function inicioDoMesAnterior(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth() - 1, 1);
}

async function loadLocalDashboard(): Promise<DashboardData> {
  const baseUrl = getLocalDashboardBaseUrl();
  if (!baseUrl) {
    return dashboardIndisponivel("Servidor local nao configurado para o Dashboard.");
  }

  const hoje = new Date();
  const inicioMes = inicioDoMes(hoje);
  const inicioMesAnt = inicioDoMesAnterior(hoje);
  const inicio6Meses = new Date(hoje.getFullYear(), hoje.getMonth() - 5, 1);

  const [vendas, produtos, saldos, lancamentos] = await Promise.all([
    fetchLocalDashboardJson<LocalVendaRow[]>(baseUrl, "/api/vendas/list", { limit: "500" }),
    fetchLocalDashboardJson<LocalProdutoRow[]>(baseUrl, "/api/produtos/list", { status: "ativo" }),
    fetchLocalDashboardJson<LocalEstoqueSaldoRow[]>(baseUrl, "/api/estoque/saldos"),
    fetchLocalDashboardJson<LocalFinanceiroRow[]>(baseUrl, "/api/financeiro/lancamentos", {
      desde_ms: String(inicio6Meses.getTime()),
      limit: "5000",
    }),
  ]);

  const vendasValidas = (vendas ?? []).filter((v) => v.status !== "cancelada");
  const dataVenda = (v: LocalVendaRow) => new Date(v.data_finalizacao ?? v.data_emissao);

  const vendasMes = vendasValidas
    .filter((v) => dataVenda(v) >= inicioMes)
    .reduce((s, v) => s + Number(v.total ?? 0), 0);

  const vendasMesAnterior = vendasValidas
    .filter((v) => {
      const d = dataVenda(v);
      return d >= inicioMesAnt && d < inicioMes;
    })
    .reduce((s, v) => s + Number(v.total ?? 0), 0);

  const seriesMap = new Map<string, { vendas: number; compras: number }>();
  for (let i = 0; i < 6; i++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - 5 + i, 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    seriesMap.set(key, { vendas: 0, compras: 0 });
  }
  for (const v of vendasValidas) {
    const d = dataVenda(v);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const ref = seriesMap.get(key);
    if (ref) ref.vendas += Number(v.total ?? 0);
  }

  const saldosMap = new Map<string, number>();
  for (const m of saldos ?? []) {
    const sinal =
      m.tipo === "entrada" || m.tipo === "devolucao"
        ? 1
        : m.tipo === "saida" || m.tipo === "transferencia"
          ? -1
          : 1;
    saldosMap.set(m.produto_id, (saldosMap.get(m.produto_id) ?? 0) + sinal * Number(m.quantidade));
  }
  const estoqueBaixo = (produtos ?? []).filter((p) => {
    const minimo = Number(p.estoque_minimo ?? 0);
    return minimo > 0 && (saldosMap.get(p.id) ?? 0) <= minimo;
  }).length;

  const lancsCanonicos = (lancamentos ?? []).map(localFinanceiroAsCanonico);
  const contasPagarLancs = lancsCanonicos.filter(
    (l) => isLancPagar(l) && !isLancRealizado(l) && !isLancCancelado(l),
  );
  const contasReceberLancs = lancsCanonicos.filter(
    (l) => isLancReceber(l) && !isLancRealizado(l) && !isLancCancelado(l),
  );

  const fluxoMap = new Map<number, { entrada: number; saida: number }>();
  const diasNoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
  for (let d = 1; d <= diasNoMes; d++) fluxoMap.set(d, { entrada: 0, saida: 0 });

  for (const l of lancsCanonicos) {
    if (!l.data_pagamento) continue;
    if (!isLancRealizado(l)) continue;
    const dp = new Date(l.data_pagamento);
    if (dp < inicioMes) continue;
    const ref = fluxoMap.get(dp.getDate());
    if (!ref) continue;
    const valor = Number(l.valor_pago ?? l.valor) || 0;
    if (isLancReceber(l)) ref.entrada += valor;
    else if (isLancPagar(l)) ref.saida += valor;
  }

  return {
    vendasMes,
    vendasMesAnterior,
    comprasMes: 0,
    comprasMesAnterior: 0,
    lucroMes: 0,
    margem: 0,
    contasPagar: contasPagarLancs.reduce((s, l) => s + calcAbertoLanc(l), 0),
    qtdContasPagar: contasPagarLancs.length,
    contasReceber: contasReceberLancs.reduce((s, l) => s + calcAbertoLanc(l), 0),
    qtdContasReceber: contasReceberLancs.length,
    estoqueBaixo,
    vendasPorMes: Array.from(seriesMap.entries()).map(([key, val]) => {
      const [, m] = key.split("-").map(Number);
      return { month: MESES_PT[m], vendas: val.vendas, compras: val.compras };
    }),
    fluxoCaixa: Array.from(fluxoMap.entries()).map(([dia, val]) => ({
      day: String(dia).padStart(2, "0"),
      entrada: val.entrada,
      saida: val.saida,
    })),
    ultimasVendas: vendasValidas.slice(0, 5).map((v) => ({
      id: v.id,
      numero: v.numero,
      cliente: v.cliente_nome ?? (v.cliente_id ? "Cliente" : "Consumidor"),
      valor: Number(v.total ?? 0),
      status: v.status,
      data: v.data_finalizacao ?? v.data_emissao,
    })),
    ultimasCompras: [],
  };
}

export function useDashboard() {
  const { user } = useAuth();
  const localDesktopMode = isLocalDesktopMode();

  return useQuery({
    queryKey: ["dashboard", user?.id],
    enabled: !!user,
    refetchInterval: 60_000,
    placeholderData: EMPTY_DASHBOARD,
    retry: localDesktopMode ? false : 1,
    queryFn: async (): Promise<DashboardData> => {
      const load = async (): Promise<DashboardData> => {
      const hoje = new Date();
      const inicioMes = inicioDoMes(hoje);
      const inicioMesAnt = inicioDoMesAnterior(hoje);
      const inicio6Meses = new Date(hoje.getFullYear(), hoje.getMonth() - 5, 1);

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
      const vendasIdsMes = (vendas ?? [])
        .filter((v) => dataVenda(v) >= inicioMes)
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

      // Canônico: lucro bruto e margem
      const lucroMes = calcLucroBruto(vendasMes, custoMes);
      const margem = calcMargemPct(vendasMes, lucroMes);

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
      // BUGFIX: filtros antigos usavam tipo "receita"/"despesa", mas o schema
      // canônico é "receber"/"pagar". Helpers aceitam ambos por segurança.
      const { data: lancamentos } = await supabase
        .from("financeiro_lancamentos")
        .select("id, tipo, valor, valor_pago, status, data_vencimento, data_pagamento, conciliado_em");

      const contasPagarLancs = (lancamentos ?? []).filter(
        (l) => isLancPagar(l) && !isLancRealizado(l) && !isLancCancelado(l),
      );
      const contasReceberLancs = (lancamentos ?? []).filter(
        (l) => isLancReceber(l) && !isLancRealizado(l) && !isLancCancelado(l) && !l.conciliado_em,
      );
      const contasPagar = contasPagarLancs.reduce((s, l) => s + calcAbertoLanc(l), 0);
      const contasReceber = contasReceberLancs.reduce((s, l) => s + calcAbertoLanc(l), 0);

      // === Fluxo de caixa do mês (somente pagamentos realizados) ===
      const fluxoMap = new Map<number, { entrada: number; saida: number }>();
      const diasNoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
      for (let d = 1; d <= diasNoMes; d++) fluxoMap.set(d, { entrada: 0, saida: 0 });

      for (const l of lancamentos ?? []) {
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
      };

      if (!localDesktopMode) return load();

      try {
        return await withTimeout(loadLocalDashboard(), LOCAL_DASHBOARD_TIMEOUT_MS);
      } catch {
        return dashboardIndisponivel(
          "Dashboard local indisponivel no momento. Os modulos operacionais locais continuam acessiveis.",
        );
      }
    },
  });
}
