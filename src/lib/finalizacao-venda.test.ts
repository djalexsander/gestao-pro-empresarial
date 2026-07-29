import { describe, expect, it } from "vitest";
import type { FinalizarVendaInput, FormaPagamento } from "@/integrations/data/types";
import {
  montarPagamentosVendaPayload,
  normalizarFinalizacaoVenda,
  trocarFormaPagamento,
  validarPagamentoFiado,
  type PagamentoFinalizacao,
} from "./finalizacao-venda";

const dadosFiadoValidos = {
  clienteId: "cliente-1",
  quantidadeParcelas: 1,
  primeiroVencimento: "2026-08-28",
};

function pagamento(forma: FormaPagamento, valor = 15, uid = forma): PagamentoFinalizacao {
  return {
    uid,
    forma,
    valor,
    valorRecebido: forma === "dinheiro" ? valor : 0,
    parcelas: forma === "cartao_credito" ? 2 : 1,
  };
}

function inputVenda(
  forma: FormaPagamento,
  pagamentos: FinalizarVendaInput["pagamentos"],
): FinalizarVendaInput {
  return {
    cliente_id: null,
    subtotal: 15,
    desconto: 0,
    total: 15,
    forma_pagamento: forma,
    status_pagamento: "pago",
    valor_recebido: forma === "dinheiro" ? 15 : null,
    troco: null,
    observacao: null,
    itens: [
      {
        produto_id: "produto-1",
        quantidade: 1,
        preco_unitario: 15,
        desconto: 0,
      },
    ],
    pagamentos,
    data_vencimento: null,
  };
}

describe("validação de Fiado na finalização da venda", () => {
  it.each([
    ["Dinheiro", "dinheiro"],
    ["Pix", "pix"],
    ["Débito", "cartao_debito"],
    ["Crédito", "cartao_credito"],
  ] as const)("venda 100%% %s conclui sem validação de Fiado", (_nome, forma) => {
    const pagamentos = [pagamento(forma)];

    expect(
      validarPagamentoFiado(pagamentos, {
        clienteId: null,
        quantidadeParcelas: 0,
        primeiroVencimento: "",
      }).erro,
    ).toBeNull();
    expect(montarPagamentosVendaPayload(pagamentos, dadosFiadoValidos)).toEqual([
      expect.objectContaining({
        forma_pagamento: forma,
        valor: 15,
      }),
    ]);
  });

  it.each([
    ["Boleto", "boleto"],
  ] as const)("%s também ignora campos específicos de Fiado", (_nome, forma) => {
    const linha = pagamento(forma);
    const validacao = validarPagamentoFiado([linha], {
      clienteId: null,
      quantidadeParcelas: 0,
      primeiroVencimento: "",
    });
    const payload = montarPagamentosVendaPayload([linha], dadosFiadoValidos);

    expect(validacao.erro).toBeNull();
    expect(payload[0]).not.toHaveProperty("quantidade_parcelas");
    expect(payload[0]).not.toHaveProperty("primeiro_vencimento");
  });

  it("venda 100% Fiado com valor maior que zero é válida", () => {
    const validacao = validarPagamentoFiado([pagamento("fiado")], dadosFiadoValidos);

    expect(validacao.erro).toBeNull();
    expect(validacao.valor).toBe(15);
    expect(validacao.parcelas).toHaveLength(1);
  });

  it("venda Fiado com valor zero é bloqueada", () => {
    const pagamentos = [pagamento("fiado", 0)];
    const validacao = validarPagamentoFiado(pagamentos, dadosFiadoValidos);

    expect(validacao.erro).toBe("O valor Fiado deve ser maior que zero.");
    expect(montarPagamentosVendaPayload(pagamentos, dadosFiadoValidos)).toEqual([]);
  });

  it("venda mista Dinheiro + Fiado valida e parcela somente o Fiado", () => {
    const pagamentos = [pagamento("dinheiro", 10, "dinheiro"), pagamento("fiado", 5, "fiado")];
    const validacao = validarPagamentoFiado(pagamentos, dadosFiadoValidos);
    const payload = montarPagamentosVendaPayload(pagamentos, dadosFiadoValidos);

    expect(validacao.erro).toBeNull();
    expect(validacao.valor).toBe(5);
    expect(validacao.parcelas[0]?.valorCentavos).toBe(500);
    expect(payload).toHaveLength(2);
    expect(payload[0]).not.toHaveProperty("quantidade_parcelas");
    expect(payload[1]).toMatchObject({
      forma_pagamento: "fiado",
      valor: 5,
      quantidade_parcelas: 1,
      primeiro_vencimento: "2026-08-28",
    });
  });

  it("trocar de Fiado para Dinheiro sinaliza a limpeza dos dados de Fiado", () => {
    const resultado = trocarFormaPagamento([pagamento("fiado")], "fiado", "dinheiro");

    expect(resultado.pagamentos[0]).toMatchObject({
      forma: "dinheiro",
      valorRecebido: 15,
      parcelas: 1,
    });
    expect(resultado.removeuUltimoFiado).toBe(true);
    expect(resultado.iniciouFiado).toBe(false);
  });

  it("venda sem Fiado não produz parcela nem metadado de lançamento Fiado", () => {
    const pagamentos = [pagamento("dinheiro", 10, "dinheiro"), pagamento("pix", 5, "pix")];
    const validacao = validarPagamentoFiado(pagamentos, {
      clienteId: null,
      quantidadeParcelas: 0,
      primeiroVencimento: "",
    });
    const payload = montarPagamentosVendaPayload(pagamentos, {
      quantidadeParcelas: 0,
      primeiroVencimento: "",
    });

    expect(validacao.pagamentos).toEqual([]);
    expect(validacao.parcelas).toEqual([]);
    expect(payload.some((item) => item.forma_pagamento === "fiado")).toBe(false);
    expect(payload.some((item) => "quantidade_parcelas" in item)).toBe(false);
  });

  it("adapter/backend ignora campos Fiado null ou zero numa distribuição normal", () => {
    const input = inputVenda("fiado", [
      {
        forma_pagamento: "pix",
        valor: 15,
        quantidade_parcelas: 0,
        primeiro_vencimento: null,
      },
    ]);
    input.data_vencimento = null;

    const normalizado = normalizarFinalizacaoVenda(input);

    expect(normalizado.data_vencimento).toBeNull();
    expect(normalizado.pagamentos).toEqual([
      {
        forma_pagamento: "pix",
        valor: 15,
      },
    ]);
  });
});
