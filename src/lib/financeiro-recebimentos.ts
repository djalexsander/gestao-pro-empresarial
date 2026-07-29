export interface PagamentoRecebidoFonte {
  id: string;
  lancamento_id: string;
  valor: number;
  data_pagamento: string;
  created_at: string | null;
  forma_pagamento: string | null;
  observacao: string | null;
  registrado_por: string | null;
}

export interface LancamentoRecebidoFonte {
  id: string;
  tipo: string;
  descricao: string;
  valor: number;
  valor_pago: number | null;
  data_pagamento: string | null;
  created_at: string | null;
  forma_pagamento: string | null;
  observacoes: string | null;
  status: string;
  venda_id: string | null;
  cliente_id: string | null;
  parcela_numero: number | null;
  parcela_total: number | null;
}

export interface VendaRecebidaFonte {
  id: string;
  numero: string;
  data_finalizacao: string | null;
  operador_id: string | null;
  terminal_id: string | null;
  cliente_id: string | null;
}

export interface RecebimentoDetalhe {
  id: string;
  lancamento_id: string;
  data_hora: string;
  venda_id: string | null;
  venda_numero: string | null;
  cliente_nome: string | null;
  origem: string;
  forma_pagamento: string | null;
  valor: number;
  operador_nome: string | null;
  terminal_nome: string | null;
  observacao: string | null;
  parcela_numero: number | null;
  parcela_total: number | null;
  status: string;
}

export interface MontarRecebimentosArgs {
  pagamentos: PagamentoRecebidoFonte[];
  lancamentos: LancamentoRecebidoFonte[];
  vendas: VendaRecebidaFonte[];
  clientes: Map<string, string>;
  operadores: Map<string, string>;
  terminais: Map<string, string>;
}

function valorRealizado(lancamento: LancamentoRecebidoFonte) {
  const pago = Number(lancamento.valor_pago) || 0;
  return pago > 0 ? pago : Number(lancamento.valor) || 0;
}

function origemRecebimento(
  lancamento: LancamentoRecebidoFonte,
  temBaixa: boolean,
) {
  if (!lancamento.venda_id) return "Outro lançamento";
  if (lancamento.parcela_total && lancamento.parcela_total > 1) {
    return temBaixa ? "Baixa de parcela" : "Parcela recebida";
  }
  if (temBaixa && lancamento.forma_pagamento === "fiado") {
    return "Baixa de fiado";
  }
  if (temBaixa) return "Baixa de venda";
  return "Venda à vista";
}

/**
 * A baixa individual é a fonte principal. Um lançamento realizado diretamente
 * só entra como fallback quando não existe baixa para o mesmo lançamento.
 */
export function montarRecebimentosDetalhados({
  pagamentos,
  lancamentos,
  vendas,
  clientes,
  operadores,
  terminais,
}: MontarRecebimentosArgs): RecebimentoDetalhe[] {
  const lancamentoMap = new Map(lancamentos.map((item) => [item.id, item]));
  const vendaMap = new Map(vendas.map((item) => [item.id, item]));
  const lancamentosComBaixa = new Set(
    pagamentos.map((pagamento) => pagamento.lancamento_id),
  );
  const detalhes: RecebimentoDetalhe[] = [];

  const montar = (
    id: string,
    lancamento: LancamentoRecebidoFonte,
    pagamento?: PagamentoRecebidoFonte,
  ) => {
    const venda = lancamento.venda_id
      ? vendaMap.get(lancamento.venda_id)
      : undefined;
    const clienteId = lancamento.cliente_id ?? venda?.cliente_id ?? null;
    return {
      id,
      lancamento_id: lancamento.id,
      data_hora:
        pagamento?.created_at ??
        venda?.data_finalizacao ??
        lancamento.created_at ??
        `${pagamento?.data_pagamento ?? lancamento.data_pagamento}T00:00:00-03:00`,
      venda_id: venda?.id ?? lancamento.venda_id,
      venda_numero: venda?.numero ?? null,
      cliente_nome: clienteId ? clientes.get(clienteId) ?? null : null,
      origem: origemRecebimento(lancamento, Boolean(pagamento)),
      forma_pagamento:
        pagamento?.forma_pagamento ?? lancamento.forma_pagamento,
      valor: pagamento ? Number(pagamento.valor) || 0 : valorRealizado(lancamento),
      operador_nome: venda?.operador_id
        ? operadores.get(venda.operador_id) ?? null
        : null,
      terminal_nome: venda?.terminal_id
        ? terminais.get(venda.terminal_id) ?? null
        : null,
      observacao: pagamento?.observacao ?? lancamento.observacoes,
      parcela_numero: lancamento.parcela_numero,
      parcela_total: lancamento.parcela_total,
      status: lancamento.status,
    } satisfies RecebimentoDetalhe;
  };

  for (const pagamento of pagamentos) {
    const lancamento = lancamentoMap.get(pagamento.lancamento_id);
    if (!lancamento || !["receber", "receita"].includes(lancamento.tipo)) {
      continue;
    }
    detalhes.push(montar(pagamento.id, lancamento, pagamento));
  }

  for (const lancamento of lancamentos) {
    if (
      lancamentosComBaixa.has(lancamento.id) ||
      !["receber", "receita"].includes(lancamento.tipo) ||
      !["pago", "recebido"].includes(lancamento.status)
    ) {
      continue;
    }
    detalhes.push(montar(`lancamento-${lancamento.id}`, lancamento));
  }

  return detalhes.sort(
    (a, b) =>
      new Date(b.data_hora).getTime() - new Date(a.data_hora).getTime(),
  );
}

export function totalizarRecebimentos(detalhes: RecebimentoDetalhe[]) {
  return {
    valor: detalhes.reduce((total, item) => total + item.valor, 0),
    quantidade: detalhes.length,
  };
}
