import type {
  FinalizarVendaInput,
  FinalizarVendaPagamento,
  FormaPagamento,
} from "@/integrations/data/types";
import {
  dataFinanceiraValida,
  gerarParcelasFiado,
  somaParcelasCentavos,
  type ParcelaFiado,
} from "@/lib/parcelamento-fiado";

export interface PagamentoFinalizacao {
  uid: string;
  forma: FormaPagamento;
  valor: number;
  valorRecebido: number;
  parcelas: number;
}

export interface DadosFiado {
  clienteId: string | null;
  quantidadeParcelas: number;
  primeiroVencimento: string;
}

export interface ValidacaoFiado {
  pagamentos: PagamentoFinalizacao[];
  valor: number;
  parcelas: ParcelaFiado[];
  erro: string | null;
}

export interface TrocaFormaResultado {
  pagamentos: PagamentoFinalizacao[];
  iniciouFiado: boolean;
  removeuUltimoFiado: boolean;
}

export function filtrarPagamentosFiado(
  pagamentos: readonly PagamentoFinalizacao[],
): PagamentoFinalizacao[] {
  return pagamentos.filter((pagamento) => pagamento.forma === "fiado");
}

export function calcularValorFiado(pagamentos: readonly PagamentoFinalizacao[]): number {
  return filtrarPagamentosFiado(pagamentos).reduce(
    (total, pagamento) => total + (Number(pagamento.valor) || 0),
    0,
  );
}

/**
 * Valida exclusivamente as linhas cuja forma é Fiado. Uma distribuição sem
 * Fiado nunca é bloqueada por cliente, valor, quantidade ou vencimento.
 */
export function validarPagamentoFiado(
  pagamentos: readonly PagamentoFinalizacao[],
  dados: DadosFiado,
): ValidacaoFiado {
  const pagamentosFiado = filtrarPagamentosFiado(pagamentos);
  const valor = calcularValorFiado(pagamentosFiado);

  if (pagamentosFiado.length === 0) {
    return { pagamentos: [], valor: 0, parcelas: [], erro: null };
  }
  if (!dados.clienteId) {
    return {
      pagamentos: pagamentosFiado,
      valor,
      parcelas: [],
      erro: "Selecione um cliente para realizar uma venda fiada.",
    };
  }
  if (pagamentosFiado.length > 1) {
    return {
      pagamentos: pagamentosFiado,
      valor,
      parcelas: [],
      erro: "Só é permitido um pagamento Fiado por venda.",
    };
  }
  if (
    !Number.isInteger(dados.quantidadeParcelas) ||
    dados.quantidadeParcelas < 1 ||
    dados.quantidadeParcelas > 60
  ) {
    return {
      pagamentos: pagamentosFiado,
      valor,
      parcelas: [],
      erro: "Informe uma quantidade válida de parcelas.",
    };
  }
  if (valor <= 0) {
    return {
      pagamentos: pagamentosFiado,
      valor,
      parcelas: [],
      erro: "O valor Fiado deve ser maior que zero.",
    };
  }
  if (!dataFinanceiraValida(dados.primeiroVencimento)) {
    return {
      pagamentos: pagamentosFiado,
      valor,
      parcelas: [],
      erro: "Informe a data do primeiro vencimento.",
    };
  }

  const parcelas = gerarParcelasFiado(valor, dados.quantidadeParcelas, dados.primeiroVencimento);
  if (
    parcelas.length !== dados.quantidadeParcelas ||
    somaParcelasCentavos(parcelas) !== Math.round(valor * 100)
  ) {
    return {
      pagamentos: pagamentosFiado,
      valor,
      parcelas,
      erro: "A soma das parcelas não corresponde ao valor fiado.",
    };
  }

  return { pagamentos: pagamentosFiado, valor, parcelas, erro: null };
}

export function trocarFormaPagamento(
  pagamentos: readonly PagamentoFinalizacao[],
  uid: string,
  forma: FormaPagamento,
): TrocaFormaResultado {
  const tinhaFiado = pagamentos.some((pagamento) => pagamento.forma === "fiado");
  const atualizados = pagamentos.map((pagamento) => {
    if (pagamento.uid !== uid) return { ...pagamento };
    const proximo = { ...pagamento, forma };
    if (
      forma === "dinheiro" &&
      (!pagamento.valorRecebido || pagamento.valorRecebido < pagamento.valor)
    ) {
      proximo.valorRecebido = pagamento.valor;
    }
    if (forma !== "cartao_credito") proximo.parcelas = 1;
    return proximo;
  });
  const temFiado = atualizados.some((pagamento) => pagamento.forma === "fiado");

  return {
    pagamentos: atualizados,
    iniciouFiado: !tinhaFiado && temFiado,
    removeuUltimoFiado: tinhaFiado && !temFiado,
  };
}

/**
 * Cria somente linhas positivas. A validação deve ser executada antes desta
 * função, de modo que uma linha Fiado de valor zero seja bloqueada e jamais
 * chegue ao backend.
 */
export function montarPagamentosVendaPayload(
  pagamentos: readonly PagamentoFinalizacao[],
  dadosFiado: Pick<DadosFiado, "quantidadeParcelas" | "primeiroVencimento">,
): FinalizarVendaPagamento[] {
  return pagamentos
    .filter((pagamento) => Number.isFinite(pagamento.valor) && pagamento.valor > 0)
    .map((pagamento) => {
      const dinheiro = pagamento.forma === "dinheiro";
      const payload: FinalizarVendaPagamento = {
        forma_pagamento: pagamento.forma,
        valor: Number(pagamento.valor.toFixed(2)),
        valor_recebido: dinheiro ? Number(pagamento.valorRecebido.toFixed(2)) : null,
        troco: dinheiro
          ? Number(Math.max(0, pagamento.valorRecebido - pagamento.valor).toFixed(2))
          : null,
        parcelas: pagamento.forma === "cartao_credito" ? pagamento.parcelas : 1,
        observacao: null,
      };

      if (pagamento.forma === "fiado") {
        payload.quantidade_parcelas = dadosFiado.quantidadeParcelas;
        payload.primeiro_vencimento = dadosFiado.primeiroVencimento;
      }
      return payload;
    });
}

/**
 * Defesa na fronteira do adapter. Metadados de Fiado são removidos de todas
 * as outras formas e o vencimento global é ignorado quando a distribuição
 * explícita não contém Fiado. A forma principal só vale como fallback legado
 * quando não existe distribuição.
 */
export function normalizarFinalizacaoVenda(input: FinalizarVendaInput): FinalizarVendaInput {
  const pagamentos = input.pagamentos?.map((pagamento) => {
    if (pagamento.forma_pagamento === "fiado") return { ...pagamento };
    const {
      quantidade_parcelas: _quantidadeParcelas,
      primeiro_vencimento: _primeiroVencimento,
      ...normalizado
    } = pagamento;
    return normalizado;
  });
  const temDistribuicao = Boolean(pagamentos?.length);
  const temFiado = temDistribuicao
    ? pagamentos!.some((pagamento) => pagamento.forma_pagamento === "fiado")
    : input.forma_pagamento === "fiado";

  return {
    ...input,
    pagamentos,
    data_vencimento: temFiado ? input.data_vencimento : null,
  };
}
