import { supabase } from "@/integrations/supabase/client";
import { calcLucroBruto, calcMargemPct } from "@/lib/financeiro-canonico";

export interface DashboardLucroBrutoMes {
  chave: string;
  receita: number;
  custo: number;
  lucro: number;
  margem: number;
  qtdItens: number;
  qtdItensSemCusto: number;
}

export interface DashboardLucroBrutoData {
  receita: number;
  custo: number;
  lucro: number;
  margem: number;
  qtdVendas: number;
  qtdItens: number;
  qtdItensSemCusto: number;
  porMes: DashboardLucroBrutoMes[];
}

function mesKey(value: string | null | undefined): string {
  if (!value) return "sem-data";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "sem-data";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function fetchDashboardLucroBruto(
  inicioTs: string,
  fimTs: string,
): Promise<DashboardLucroBrutoData> {
  const { data: vendasData, error: vendasError } = await supabase
    .from("vendas")
    .select("id, total, data_finalizacao")
    .gte("data_finalizacao", inicioTs)
    .lte("data_finalizacao", fimTs)
    .neq("status", "cancelada")
    .limit(5000);
  if (vendasError) throw vendasError;

  const vendas = (vendasData ?? []) as Array<{
    id: string;
    total: number | null;
    data_finalizacao: string | null;
  }>;

  const porMes = new Map<string, DashboardLucroBrutoMes>();
  for (const venda of vendas) {
    const chave = mesKey(venda.data_finalizacao);
    const ref =
      porMes.get(chave) ??
      {
        chave,
        receita: 0,
        custo: 0,
        lucro: 0,
        margem: 0,
        qtdItens: 0,
        qtdItensSemCusto: 0,
      };
    ref.receita += Number(venda.total ?? 0) || 0;
    porMes.set(chave, ref);
  }

  const vendaIds = vendas.map((v) => v.id);
  if (vendaIds.length > 0) {
    const { data: itensData, error: itensError } = await supabase
      .from("venda_itens")
      .select("venda_id, produto_id, quantidade, produto:produtos(preco_custo)")
      .in("venda_id", vendaIds)
      .limit(20000);
    if (itensError) throw itensError;

    const vendaMes = new Map(vendas.map((v) => [v.id, mesKey(v.data_finalizacao)]));
    for (const item of (itensData ?? []) as Array<{
      venda_id: string;
      produto_id: string | null;
      quantidade: number | string | null;
      produto: { preco_custo: number | string | null } | null;
    }>) {
      const chave = vendaMes.get(item.venda_id);
      if (!chave) continue;
      const ref = porMes.get(chave);
      if (!ref) continue;
      const quantidade = Number(item.quantidade ?? 0) || 0;
      const custoUnitario = Number(item.produto?.preco_custo ?? 0) || 0;
      ref.custo += quantidade * custoUnitario;
      ref.qtdItens += 1;
      if (custoUnitario <= 0) ref.qtdItensSemCusto += 1;
    }
  }

  let receita = 0;
  let custo = 0;
  let qtdItens = 0;
  let qtdItensSemCusto = 0;
  const meses = Array.from(porMes.values())
    .map((m) => {
      const lucro = calcLucroBruto(m.receita, m.custo);
      return {
        ...m,
        lucro,
        margem: calcMargemPct(m.receita, lucro),
      };
    })
    .sort((a, b) => (a.chave < b.chave ? 1 : -1));

  for (const mes of meses) {
    receita += mes.receita;
    custo += mes.custo;
    qtdItens += mes.qtdItens;
    qtdItensSemCusto += mes.qtdItensSemCusto;
  }
  const lucro = calcLucroBruto(receita, custo);

  return {
    receita,
    custo,
    lucro,
    margem: calcMargemPct(receita, lucro),
    qtdVendas: vendas.length,
    qtdItens,
    qtdItensSemCusto,
    porMes: meses,
  };
}
