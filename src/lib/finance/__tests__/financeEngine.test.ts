import { describe, expect, it } from "vitest";
import {
  agregarPorForma,
  calcularRateio,
  calcularResultadoReal,
  montarFluxoCaixa,
  ratearPorForma,
} from "..";

describe("calcularRateio — proporcional", () => {
  it("calcula 46,15% recebido (exemplo do briefing)", () => {
    const r = calcularRateio({
      venda_id: "v1",
      valor_total: 650,
      custo_total: 600,
      valor_pago: 300,
    });
    expect(r.percentual_recebido).toBeCloseTo(300 / 650, 5);
    expect(r.custo_realizado).toBeCloseTo(276.92, 2);
    expect(r.lucro_realizado).toBeCloseTo(23.08, 2);
    expect(r.custo_pendente).toBeCloseTo(323.08, 2);
    expect(r.lucro_pendente).toBeCloseTo(26.92, 2);
    expect(r.saldo_restante).toBe(350);
  });

  it("fiado puro (0% recebido)", () => {
    const r = calcularRateio({
      venda_id: "v2",
      valor_total: 100,
      custo_total: 60,
      valor_pago: 0,
    });
    expect(r.custo_realizado).toBe(0);
    expect(r.lucro_realizado).toBe(0);
    expect(r.custo_pendente).toBe(60);
    expect(r.lucro_pendente).toBe(40);
  });

  it("100% recebido", () => {
    const r = calcularRateio({
      venda_id: "v3",
      valor_total: 100,
      custo_total: 70,
      valor_pago: 100,
    });
    expect(r.custo_realizado).toBe(70);
    expect(r.lucro_realizado).toBe(30);
    expect(r.custo_pendente).toBe(0);
    expect(r.lucro_pendente).toBe(0);
  });

  it("clampa valor_pago > valor_total", () => {
    const r = calcularRateio({
      venda_id: "v4",
      valor_total: 100,
      custo_total: 50,
      valor_pago: 200,
    });
    expect(r.valor_pago).toBe(100);
    expect(r.percentual_recebido).toBe(1);
  });
});

describe("ratearPorForma — recebimento misto", () => {
  it("100 dinheiro + 200 pix + 350 fiado proporcional", () => {
    const venda = {
      venda_id: "v5",
      valor_total: 650,
      custo_total: 600,
      valor_pago: 300, // só dinheiro+pix entraram
      pagamentos: [
        { forma: "dinheiro" as const, valor: 100 },
        { forma: "pix" as const, valor: 200 },
      ],
    };
    const partes = ratearPorForma(venda);
    expect(partes).toHaveLength(2);
    // 100/300 e 200/300
    expect(partes[0].participacao).toBeCloseTo(1 / 3, 5);
    expect(partes[1].participacao).toBeCloseTo(2 / 3, 5);
    const soma = partes.reduce((s, p) => s + p.custo_realizado, 0);
    expect(soma).toBeCloseTo(276.92, 1);
  });
});

describe("agregarPorForma", () => {
  it("agrega vendido/recebido/lucro/taxa por forma", () => {
    const linhas = agregarPorForma([
      {
        venda_id: "a",
        valor_total: 100,
        custo_total: 60,
        valor_pago: 100,
        pagamentos: [{ forma: "credito", valor: 100 }],
      },
      {
        venda_id: "b",
        valor_total: 50,
        custo_total: 30,
        valor_pago: 50,
        pagamentos: [{ forma: "pix", valor: 50 }],
      },
    ]);
    const credito = linhas.find((l) => l.forma === "credito")!;
    const pix = linhas.find((l) => l.forma === "pix")!;
    expect(credito.total_recebido).toBe(100);
    expect(credito.custo_realizado).toBe(60);
    expect(credito.lucro_bruto).toBe(40);
    expect(credito.taxa).toBeGreaterThan(0); // taxa padrão crédito
    expect(credito.lucro_liquido).toBeLessThan(credito.lucro_bruto);
    expect(pix.taxa).toBe(0);
    expect(pix.lucro_liquido).toBe(20);
  });
});

describe("calcularResultadoReal", () => {
  it("resultado real = receita_liquida − custos_realizados − despesas", () => {
    const out = calcularResultadoReal({
      vendas: [
        {
          venda_id: "a",
          valor_total: 100,
          custo_total: 60,
          valor_pago: 100,
          pagamentos: [{ forma: "dinheiro", valor: 100 }],
        },
        {
          venda_id: "b",
          valor_total: 200,
          custo_total: 140,
          valor_pago: 100, // 50%
          pagamentos: [{ forma: "fiado", valor: 100 }],
        },
      ],
      despesas: 30,
    });
    expect(out.receita_bruta).toBe(300);
    expect(out.recebido).toBe(200);
    expect(out.previsto).toBe(100);
    expect(out.custos_realizados).toBeCloseTo(60 + 70, 2);
    expect(out.custos_pendentes).toBeCloseTo(70, 2);
    expect(out.taxas).toBe(0); // dinheiro+fiado
    expect(out.receita_liquida).toBe(200);
    expect(out.lucro_bruto).toBe(100); // 300 − 200
    expect(out.lucro_liquido).toBeCloseTo(200 - 130 - 30, 2); // 40
    expect(out.resultado_operacional_real).toBe(out.lucro_liquido);
  });
});

describe("montarFluxoCaixa", () => {
  it("separa entradas operacionais, previstas e saídas", () => {
    const fluxo = montarFluxoCaixa(
      [
        {
          venda_id: "a",
          valor_total: 100,
          custo_total: 50,
          valor_pago: 100,
          pagamentos: [{ forma: "pix", valor: 100 }],
        },
        {
          venda_id: "b",
          valor_total: 200,
          custo_total: 120,
          valor_pago: 0,
          pagamentos: [],
        },
      ],
      [
        { tipo: "compra", valor: 80 },
        { tipo: "despesa", valor: 20 },
      ],
    );
    expect(fluxo.entradas_operacionais.total).toBe(100);
    expect(fluxo.entradas_operacionais.por_forma.pix).toBe(100);
    expect(fluxo.entradas_previstas.fiado).toBe(200);
    expect(fluxo.saidas.compras).toBe(80);
    expect(fluxo.saidas.despesas).toBe(20);
    expect(fluxo.saidas.total).toBe(100);
    expect(fluxo.liquido).toBe(0);
  });
});
