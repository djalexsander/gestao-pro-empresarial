import { describe, expect, it } from "vitest";
import {
  calcularMetricasProdutosVendidos,
  consolidarProdutosVendidos,
  custoUnitarioHistorico,
  dataFinalizacaoNoPeriodoSaoPaulo,
  itemProdutoVendidoPassaFiltros,
  periodoFinalizacaoSaoPaulo,
  type ProdutoVendidoItem,
} from "./produtos-vendidos";
import {
  montarRecebimentosDetalhados,
  totalizarRecebimentos,
  type LancamentoRecebidoFonte,
  type PagamentoRecebidoFonte,
} from "./financeiro-recebimentos";

function item(
  forma: string,
  overrides: Partial<ProdutoVendidoItem> = {},
): ProdutoVendidoItem {
  return {
    item_id: "item-1",
    venda_id: "venda-1",
    venda_numero: "VND-000001",
    data_emissao: "2026-07-28",
    data_finalizacao: "2026-07-28T21:01:00.000Z",
    produto_id: "produto-1",
    produto_nome: "Café",
    variacao_id: null,
    variacao_nome: null,
    sku: "CAF-1",
    codigo_barras: "7890001",
    quantidade: 2,
    preco_unitario: 10,
    desconto: 0,
    total: 20,
    custo_unitario: 4,
    custo_total: 8,
    lucro: 12,
    margem: 60,
    formas_pagamento: [forma],
    forma_pagamento: forma,
    operador_id: "operador-1",
    caixa_id: "caixa-1",
    terminal_id: "terminal-1",
    cliente_nome: "Cliente Teste",
    status_venda: "faturada",
    ...overrides,
  };
}

const filtrosBase = {
  busca: "",
  operador: "todos",
  terminal: "todos",
  forma: "todos",
  incluirCanceladas: false,
};

function lancamento(
  overrides: Partial<LancamentoRecebidoFonte> = {},
): LancamentoRecebidoFonte {
  return {
    id: "lanc-1",
    tipo: "receber",
    descricao: "Venda VND-000001",
    valor: 20,
    valor_pago: 20,
    data_pagamento: "2026-07-28",
    created_at: "2026-07-28T21:01:00.000Z",
    forma_pagamento: "dinheiro",
    observacoes: null,
    status: "pago",
    venda_id: "venda-1",
    cliente_id: "cliente-1",
    parcela_numero: 1,
    parcela_total: 1,
    ...overrides,
  };
}

function pagamento(
  overrides: Partial<PagamentoRecebidoFonte> = {},
): PagamentoRecebidoFonte {
  return {
    id: "pg-1",
    lancamento_id: "lanc-1",
    valor: 20,
    data_pagamento: "2026-07-28",
    created_at: "2026-07-28T21:05:00.000Z",
    forma_pagamento: "pix",
    observacao: "Baixa confirmada",
    registrado_por: "user-1",
    ...overrides,
  };
}

function montar(
  pagamentos: PagamentoRecebidoFonte[],
  lancamentos: LancamentoRecebidoFonte[],
) {
  return montarRecebimentosDetalhados({
    pagamentos,
    lancamentos,
    vendas: [
      {
        id: "venda-1",
        numero: "VND-000001",
        data_finalizacao: "2026-07-28T21:01:00.000Z",
        operador_id: "operador-1",
        terminal_id: "terminal-1",
        cliente_id: "cliente-1",
      },
    ],
    clientes: new Map([["cliente-1", "Cliente Teste"]]),
    operadores: new Map([["operador-1", "Juliana"]]),
    terminais: new Map([["terminal-1", "PDV 01"]]),
  });
}

describe("Produtos Vendidos e Recebido hoje", () => {
  it("1. inclui venda em dinheiro com item", () => {
    expect(itemProdutoVendidoPassaFiltros(item("dinheiro"), filtrosBase)).toBe(true);
  });

  it("2. inclui venda Pix com item", () => {
    expect(itemProdutoVendidoPassaFiltros(item("pix"), filtrosBase)).toBe(true);
  });

  it("3. inclui venda fiada em Produtos Vendidos", () => {
    expect(itemProdutoVendidoPassaFiltros(item("fiado"), filtrosBase)).toBe(true);
  });

  it("4. não recebe venda fiada antes da baixa", () => {
    const detalhes = montar(
      [],
      [
        lancamento({
          forma_pagamento: "fiado",
          status: "pendente",
          valor_pago: 0,
          data_pagamento: null,
        }),
      ],
    );
    expect(detalhes).toEqual([]);
  });

  it("5. inclui a baixa de fiado em Recebido hoje", () => {
    const detalhes = montar(
      [pagamento()],
      [lancamento({ forma_pagamento: "fiado", status: "parcial" })],
    );
    expect(detalhes).toHaveLength(1);
    expect(detalhes[0].origem).toBe("Baixa de fiado");
  });

  it("6. exclui venda cancelada por padrão e não soma quando exibida", () => {
    const cancelado = item("dinheiro", { status_venda: "cancelada" });
    expect(itemProdutoVendidoPassaFiltros(cancelado, filtrosBase)).toBe(false);
    expect(
      calcularMetricasProdutosVendidos([
        item("dinheiro"),
        cancelado,
      ]).receita,
    ).toBe(20);
  });

  it("7. consolida produto com variação separadamente", () => {
    const resultado = consolidarProdutosVendidos([
      item("pix", {
        variacao_id: "var-1",
        variacao_nome: "500 g",
        sku: "CAF-500",
      }),
    ]);
    expect(resultado[0]).toMatchObject({
      variacao_nome: "500 g",
      sku: "CAF-500",
    });
  });

  it("8. mantém produto sem variação", () => {
    const resultado = consolidarProdutosVendidos([item("pix")]);
    expect(resultado[0].produto_nome).toBe("Café");
    expect(resultado[0].variacao_nome).toBeNull();
  });

  it("9. considera Hoje no timezone de São Paulo", () => {
    expect(
      dataFinalizacaoNoPeriodoSaoPaulo(
        "2026-07-29T02:30:00.000Z",
        "2026-07-28",
        "2026-07-28",
      ),
    ).toBe(true);
    expect(
      dataFinalizacaoNoPeriodoSaoPaulo(
        "2026-07-29T03:00:00.000Z",
        "2026-07-28",
        "2026-07-28",
      ),
    ).toBe(false);
  });

  it("10. monta corretamente o período Este mês", () => {
    expect(periodoFinalizacaoSaoPaulo("2026-07-01", "2026-07-28")).toEqual({
      inicioTs: "2026-07-01T00:00:00.000-03:00",
      fimTs: "2026-07-28T23:59:59.999-03:00",
    });
  });

  it("11. busca por nome, SKU, código e número da venda", () => {
    for (const busca of ["café", "caf-1", "7890001", "vnd-000001"]) {
      expect(
        itemProdutoVendidoPassaFiltros(item("pix"), {
          ...filtrosBase,
          busca,
        }),
      ).toBe(true);
    }
  });

  it("12. filtra por operador", () => {
    expect(
      itemProdutoVendidoPassaFiltros(item("pix"), {
        ...filtrosBase,
        operador: "operador-1",
      }),
    ).toBe(true);
    expect(
      itemProdutoVendidoPassaFiltros(item("pix"), {
        ...filtrosBase,
        operador: "outro",
      }),
    ).toBe(false);
  });

  it("13. filtra por terminal", () => {
    expect(
      itemProdutoVendidoPassaFiltros(item("pix"), {
        ...filtrosBase,
        terminal: "terminal-1",
      }),
    ).toBe(true);
    expect(
      itemProdutoVendidoPassaFiltros(item("pix"), {
        ...filtrosBase,
        terminal: "outro",
      }),
    ).toBe(false);
  });

  it("14. filtra pagamentos mistos pela forma escolhida", () => {
    const misto = item("dinheiro", {
      formas_pagamento: ["dinheiro", "fiado"],
      forma_pagamento: "dinheiro + fiado",
    });
    expect(
      itemProdutoVendidoPassaFiltros(misto, {
        ...filtrosBase,
        forma: "fiado",
      }),
    ).toBe(true);
  });

  it("15. não duplica lançamento que já possui baixa", () => {
    const detalhes = montar([pagamento()], [lancamento()]);
    expect(detalhes).toHaveLength(1);
    expect(totalizarRecebimentos(detalhes)).toEqual({
      valor: 20,
      quantidade: 1,
    });
  });

  it("16. produz os detalhes individuais exigidos pelo modal", () => {
    const [detalhe] = montar(
      [pagamento()],
      [lancamento({ parcela_numero: 2, parcela_total: 3 })],
    );
    expect(detalhe).toMatchObject({
      venda_numero: "VND-000001",
      cliente_nome: "Cliente Teste",
      forma_pagamento: "pix",
      operador_nome: "Juliana",
      terminal_nome: "PDV 01",
      observacao: "Baixa confirmada",
      parcela_numero: 2,
      parcela_total: 3,
      valor: 20,
    });
  });

  it("17. prioriza custo histórico e calcula lucro e margem com ele", () => {
    const custo = custoUnitarioHistorico(3, 8, 10);
    const venda = item("dinheiro", {
      custo_unitario: custo,
      custo_total: custo * 2,
      lucro: 14,
      margem: 70,
    });
    expect(custo).toBe(3);
    expect(calcularMetricasProdutosVendidos([venda])).toMatchObject({
      custo: 6,
      lucro: 14,
      margem: 70,
    });
  });
});
