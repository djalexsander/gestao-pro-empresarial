import { describe, expect, it } from "vitest";
import { normalizarTermoBusca, produtoCorrespondeBusca } from "./produto-busca";

// Produto do caso reportado: SKU IMP-TER-DE-ETI-001, EAN 2003713972655.
const impressora = {
  nome: "IMPRESSORA TÉRMICA DE ETIQUETAS",
  sku: "IMP-TER-DE-ETI-001",
  codigo_barras: "2003713972655",
  codigo_interno: "IMP-001",
};

describe("normalizarTermoBusca", () => {
  it("remove espaços das pontas e baixa a caixa", () => {
    expect(normalizarTermoBusca("  IMP-TER  ")).toBe("imp-ter");
  });
});

describe("produtoCorrespondeBusca", () => {
  it("termo vazio casa com qualquer produto (sem filtro)", () => {
    expect(produtoCorrespondeBusca(impressora, "")).toBe(true);
    expect(produtoCorrespondeBusca(impressora, "   ")).toBe(true);
  });

  // ---- Regressão obrigatória: casos 1 a 4 ----

  it("caso 1 — encontra pelo nome (parcial, sem acento na caixa)", () => {
    expect(produtoCorrespondeBusca(impressora, "impressora")).toBe(true);
    expect(produtoCorrespondeBusca(impressora, "ETIQUETAS")).toBe(true);
  });

  it("caso 2 — encontra pelo SKU (completo e parcial)", () => {
    expect(produtoCorrespondeBusca(impressora, "IMP-TER-DE-ETI-001")).toBe(true);
    expect(produtoCorrespondeBusca(impressora, "imp-ter-de-eti")).toBe(true);
  });

  it("caso 3 — encontra pelo código interno quando preenchido", () => {
    expect(produtoCorrespondeBusca(impressora, "IMP-001")).toBe(true);
  });

  it("caso 3b — código interno ausente não quebra o filtro", () => {
    const semInterno = { ...impressora, codigo_interno: null };
    expect(produtoCorrespondeBusca(semInterno, "IMP-001")).toBe(false);
    expect(produtoCorrespondeBusca(semInterno, "impressora")).toBe(true);
  });

  it("caso 4 / 5 / 6 — encontra pelo EAN exato (Produtos e Estoque)", () => {
    expect(produtoCorrespondeBusca(impressora, "2003713972655")).toBe(true);
  });

  it("caso 4b — encontra por trecho do código de barras", () => {
    expect(produtoCorrespondeBusca(impressora, "20037139")).toBe(true);
  });

  it("bipagem com espaços/quebra ao redor do código ainda casa", () => {
    expect(produtoCorrespondeBusca(impressora, " 2003713972655 ")).toBe(true);
    expect(produtoCorrespondeBusca(impressora, "2003713972655\n")).toBe(true);
  });

  it("não casa com código de outro produto", () => {
    expect(produtoCorrespondeBusca(impressora, "7891234567895")).toBe(false);
    expect(produtoCorrespondeBusca(impressora, "CANETA")).toBe(false);
  });

  it("codigo_barras nulo (produto sem EAN) não quebra e ainda acha por nome/sku", () => {
    const semEan = { nome: "Caneta Azul", sku: "CAN-AZU-001", codigo_barras: null };
    expect(produtoCorrespondeBusca(semEan, "9999999999999")).toBe(false);
    expect(produtoCorrespondeBusca(semEan, "caneta")).toBe(true);
    expect(produtoCorrespondeBusca(semEan, "CAN-AZU-001")).toBe(true);
  });
});
