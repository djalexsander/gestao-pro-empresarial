import { supabase } from "@/integrations/supabase/client";
import {
  calcAbertoLanc,
  isLancCancelado,
  isLancPagar,
  isLancRealizado,
  isLancReceber,
} from "@/lib/financeiro-canonico";

export type DashboardFinanceiroKpiTipo = "pagar" | "receber";

export interface DashboardFinanceiroKpiRow {
  id: string;
  identificador: string;
  data: string | null;
  descricao: string;
  valor: number;
  valorOriginal: number;
  valorPago: number;
  vendaNumero: string | null;
  vendaData: string | null;
  parcelaNumero: number;
  parcelaTotal: number;
  lancamentoId: string;
  status: string;
}

export interface DashboardFinanceiroKpiResult {
  rows: DashboardFinanceiroKpiRow[];
  total: number;
  quantidade: number;
  vencidosTotal: number;
  vencidosQuantidade: number;
}

type LancamentoDashboard = {
  id: string;
  descricao: string | null;
  valor: number | string | null;
  valor_pago: number | string | null;
  status: string | null;
  data_vencimento: string | null;
  tipo: string | null;
  fornecedor_id: string | null;
  cliente_id: string | null;
  forma_pagamento: string | null;
  conciliado_em: string | null;
  parcela_numero: number | null;
  parcela_total: number | null;
  venda: { numero: string | null; data_finalizacao: string | null } | null;
};

function statusAberto(l: LancamentoDashboard, hojeStr: string) {
  const venc = l.data_vencimento ?? "";
  return venc && venc < hojeStr ? "vencido" : l.status ?? "aberto";
}

export async function fetchDashboardFinanceiroKpi(
  tipo: DashboardFinanceiroKpiTipo,
): Promise<DashboardFinanceiroKpiResult> {
  const { data, error } = await supabase
    .from("financeiro_lancamentos")
    .select(
      "id, descricao, valor, valor_pago, status, data_vencimento, tipo, fornecedor_id, cliente_id, forma_pagamento, conciliado_em, parcela_numero, parcela_total, venda:vendas(numero, data_finalizacao)",
    )
    .order("data_vencimento", { ascending: true })
    .limit(5000);

  if (error) throw error;

  const lancs = ((data ?? []) as LancamentoDashboard[])
    .filter((l) => {
      if (tipo === "pagar" && !isLancPagar(l)) return false;
      if (tipo === "receber" && !isLancReceber(l)) return false;
      if (isLancCancelado(l) || isLancRealizado(l)) return false;
      if (tipo === "receber" && l.conciliado_em) return false;
      return calcAbertoLanc(l) > 0;
    });

  const fornecedorIds = [
    ...new Set(lancs.map((l) => l.fornecedor_id).filter(Boolean) as string[]),
  ];
  const clienteIds = [
    ...new Set(lancs.map((l) => l.cliente_id).filter(Boolean) as string[]),
  ];

  const [fornRes, cliRes] = await Promise.all([
    fornecedorIds.length
      ? supabase
          .from("fornecedores")
          .select("id, razao_social, nome_fantasia")
          .in("id", fornecedorIds)
      : Promise.resolve({
          data: [] as { id: string; razao_social: string; nome_fantasia: string | null }[],
        }),
    clienteIds.length
      ? supabase.from("clientes").select("id, nome").in("id", clienteIds)
      : Promise.resolve({ data: [] as { id: string; nome: string }[] }),
  ]);

  const fornMap = new Map(
    (fornRes.data ?? []).map((f) => [f.id, f.nome_fantasia || f.razao_social]),
  );
  const cliMap = new Map((cliRes.data ?? []).map((c) => [c.id, c.nome]));
  const hojeStr = new Date().toISOString().slice(0, 10);

  const rows = lancs.map((l) => {
    const isPagar = tipo === "pagar";
    const identificador = isPagar
      ? l.fornecedor_id
        ? (fornMap.get(l.fornecedor_id) ?? "-")
        : "-"
      : l.cliente_id
        ? (cliMap.get(l.cliente_id) ?? "-")
        : "-";

    return {
      id: l.id,
      identificador,
      data: l.data_vencimento,
      descricao: l.descricao ?? "-",
      valor: calcAbertoLanc(l),
      valorOriginal: Number(l.valor) || 0,
      valorPago: Number(l.valor_pago) || 0,
      vendaNumero: l.venda?.numero ?? null,
      vendaData: l.venda?.data_finalizacao ?? null,
      parcelaNumero: Number(l.parcela_numero) || 1,
      parcelaTotal: Number(l.parcela_total) || 1,
      lancamentoId: l.id,
      status: statusAberto(l, hojeStr),
    };
  });

  const total = rows.reduce((s, r) => s + r.valor, 0);
  const vencidos = rows.filter((r) => r.status === "vencido");

  return {
    rows,
    total,
    quantidade: rows.length,
    vencidosTotal: vencidos.reduce((s, r) => s + r.valor, 0),
    vencidosQuantidade: vencidos.length,
  };
}
