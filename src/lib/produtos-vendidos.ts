export const VENDA_STATUS_FINALIZADOS = [
  "aprovada",
  "faturada",
  "entregue",
] as const;

export type VendaStatusFinalizado =
  (typeof VENDA_STATUS_FINALIZADOS)[number];

export interface ProdutoVendidoItem {
  item_id: string;
  venda_id: string;
  venda_numero: string;
  data_emissao: string;
  data_finalizacao: string;
  produto_id: string | null;
  produto_nome: string;
  variacao_id: string | null;
  variacao_nome: string | null;
  sku: string | null;
  codigo_barras: string | null;
  quantidade: number;
  preco_unitario: number;
  desconto: number;
  total: number;
  custo_unitario: number;
  custo_total: number;
  lucro: number;
  margem: number;
  formas_pagamento: string[];
  forma_pagamento: string | null;
  operador_id: string | null;
  caixa_id: string | null;
  terminal_id: string | null;
  cliente_nome: string | null;
  status_venda: string;
}

export interface ProdutoVendidoFiltros {
  busca: string;
  operador: string;
  terminal: string;
  forma: string;
  incluirCanceladas: boolean;
}

export interface ProdutoVendidoMetricas {
  qtd: number;
  receita: number;
  custo: number;
  lucro: number;
  margem: number;
  vendas: number;
  itens: number;
}

export interface ProdutoVendidoConsolidado {
  produto_id: string | null;
  produto_nome: string;
  variacao_id: string | null;
  variacao_nome: string | null;
  sku: string | null;
  codigo_barras: string | null;
  quantidade: number;
  receita: number;
  custo: number;
  lucro: number;
  margem: number;
  vendas: number;
}

/**
 * O banco armazena data_finalizacao em timestamptz. O relatório é operacional
 * no horário comercial de São Paulo, portanto os limites precisam carregar o
 * offset explicitamente em vez de deixar o Postgres interpretar uma data sem
 * timezone como UTC.
 */
export function periodoFinalizacaoSaoPaulo(inicio: string, fim: string) {
  return {
    inicioTs: `${inicio}T00:00:00.000-03:00`,
    fimTs: `${fim}T23:59:59.999-03:00`,
  };
}

export function dataFinalizacaoNoPeriodoSaoPaulo(
  dataFinalizacao: string,
  inicio: string,
  fim: string,
) {
  const limites = periodoFinalizacaoSaoPaulo(inicio, fim);
  const instante = new Date(dataFinalizacao).getTime();
  return (
    instante >= new Date(limites.inicioTs).getTime() &&
    instante <= new Date(limites.fimTs).getTime()
  );
}

export function statusVendaEntraNoRelatorio(
  status: string,
  incluirCanceladas: boolean,
) {
  if (status === "cancelada") return incluirCanceladas;
  return (VENDA_STATUS_FINALIZADOS as readonly string[]).includes(status);
}

export function custoUnitarioHistorico(
  custoMovimento: number | null | undefined,
  custoVariacao: number | null | undefined,
  custoProduto: number | null | undefined,
) {
  if (custoMovimento != null && Number.isFinite(Number(custoMovimento))) {
    return Number(custoMovimento);
  }
  if (custoVariacao != null && Number.isFinite(Number(custoVariacao))) {
    return Number(custoVariacao);
  }
  return Number(custoProduto) || 0;
}

export function itemProdutoVendidoPassaFiltros(
  item: ProdutoVendidoItem,
  filtros: ProdutoVendidoFiltros,
) {
  if (!statusVendaEntraNoRelatorio(item.status_venda, filtros.incluirCanceladas)) {
    return false;
  }
  if (filtros.operador !== "todos") {
    if (filtros.operador === "_sem") {
      if (item.operador_id) return false;
    } else if (item.operador_id !== filtros.operador) {
      return false;
    }
  }
  if (filtros.terminal !== "todos") {
    if (filtros.terminal === "_sem") {
      if (item.terminal_id) return false;
    } else if (item.terminal_id !== filtros.terminal) {
      return false;
    }
  }
  if (
    filtros.forma !== "todos" &&
    !item.formas_pagamento.includes(filtros.forma)
  ) {
    return false;
  }

  const busca = filtros.busca.trim().toLocaleLowerCase("pt-BR");
  if (!busca) return true;
  return [
    item.produto_nome,
    item.variacao_nome,
    item.sku,
    item.codigo_barras,
    item.venda_numero,
  ].some((valor) => valor?.toLocaleLowerCase("pt-BR").includes(busca));
}

function itensAtivos(itens: ProdutoVendidoItem[]) {
  return itens.filter((item) => item.status_venda !== "cancelada");
}

export function calcularMetricasProdutosVendidos(
  itens: ProdutoVendidoItem[],
): ProdutoVendidoMetricas {
  let qtd = 0;
  let receita = 0;
  let custo = 0;
  const vendas = new Set<string>();
  const ativos = itensAtivos(itens);

  for (const item of ativos) {
    qtd += item.quantidade;
    receita += item.total;
    custo += item.custo_total;
    vendas.add(item.venda_id);
  }
  const lucro = receita - custo;
  return {
    qtd,
    receita,
    custo,
    lucro,
    margem: receita > 0 ? (lucro / receita) * 100 : 0,
    vendas: vendas.size,
    itens: ativos.length,
  };
}

export function consolidarProdutosVendidos(
  itens: ProdutoVendidoItem[],
): ProdutoVendidoConsolidado[] {
  const grupos = new Map<
    string,
    ProdutoVendidoConsolidado & { vendaIds: Set<string> }
  >();

  for (const item of itensAtivos(itens)) {
    const chave = [
      item.produto_id ?? item.produto_nome,
      item.variacao_id ?? item.variacao_nome ?? "",
    ].join("::");
    const atual = grupos.get(chave) ?? {
      produto_id: item.produto_id,
      produto_nome: item.produto_nome,
      variacao_id: item.variacao_id,
      variacao_nome: item.variacao_nome,
      sku: item.sku,
      codigo_barras: item.codigo_barras,
      quantidade: 0,
      receita: 0,
      custo: 0,
      lucro: 0,
      margem: 0,
      vendas: 0,
      vendaIds: new Set<string>(),
    };
    atual.quantidade += item.quantidade;
    atual.receita += item.total;
    atual.custo += item.custo_total;
    atual.vendaIds.add(item.venda_id);
    grupos.set(chave, atual);
  }

  return Array.from(grupos.values())
    .map(({ vendaIds, ...grupo }) => {
      grupo.vendas = vendaIds.size;
      grupo.lucro = grupo.receita - grupo.custo;
      grupo.margem =
        grupo.receita > 0 ? (grupo.lucro / grupo.receita) * 100 : 0;
      return grupo;
    })
    .sort((a, b) => b.quantidade - a.quantidade);
}
