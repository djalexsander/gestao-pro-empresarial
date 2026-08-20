import { describe, expect, it } from "vitest";
import { gerarProximoSku, montarSku, normalizarBaseSku, proximoSufixoNumerico } from "./sku";

describe("normalizarBaseSku", () => {
  it("segue o exemplo de referencia (nome com espacos)", () => {
    expect(normalizarBaseSku("Impressora térmica 80mm")).toBe("IMP-TER-80M");
  });

  it("remove acentos", () => {
    expect(normalizarBaseSku("Café com Leite")).toBe("CAF-COM-LEI");
  });

  it("remove caracteres especiais e nao depende de espacos", () => {
    expect(normalizarBaseSku("Água & Sal!!")).toBe("AGU-SAL");
  });

  it("lida com nomes muito curtos", () => {
    expect(normalizarBaseSku("X")).toBe("X");
    expect(normalizarBaseSku("AB")).toBe("AB");
  });

  it("lida com nomes muito longos (palavra unica, sem espacos)", () => {
    const nome = "SuperProdutoImportadoDeAltaQualidade2000XPTO";
    const base = normalizarBaseSku(nome);
    expect(base).toBe("SUPERPRODU");
    expect(base.length).toBeLessThanOrEqual(24);
  });

  it("limita a 4 tokens em nomes com muitas palavras", () => {
    expect(normalizarBaseSku("Um Dois Tres Quatro Cinco Seis")).toBe("UM-DOI-TRE-QUA");
  });

  it("usa fallback PROD quando nao sobra nenhum caractere valido", () => {
    expect(normalizarBaseSku("!!! ---")).toBe("PROD");
    expect(normalizarBaseSku("")).toBe("PROD");
    expect(normalizarBaseSku(undefined)).toBe("PROD");
    expect(normalizarBaseSku(null)).toBe("PROD");
  });

  it("e deterministico (mesmo nome sempre gera a mesma base)", () => {
    expect(normalizarBaseSku("Impressora térmica 80mm")).toBe(
      normalizarBaseSku("Impressora térmica 80mm"),
    );
  });

  it("normaliza maiusculas/minusculas", () => {
    expect(normalizarBaseSku("impressora termica 80mm")).toBe("IMP-TER-80M");
    expect(normalizarBaseSku("IMPRESSORA TERMICA 80MM")).toBe("IMP-TER-80M");
  });
});

describe("montarSku", () => {
  it("preenche com zeros a esquerda ate 3 digitos", () => {
    expect(montarSku("IMP-TER-80M", 1)).toBe("IMP-TER-80M-001");
    expect(montarSku("IMP-TER-80M", 42)).toBe("IMP-TER-80M-042");
  });

  it("nao trunca sequencias grandes (sem limite artificial)", () => {
    expect(montarSku("IMP-TER-80M", 1000)).toBe("IMP-TER-80M-1000");
    expect(montarSku("IMP-TER-80M", 123456)).toBe("IMP-TER-80M-123456");
  });
});

describe("proximoSufixoNumerico", () => {
  it("retorna 1 quando nao ha SKU parecido (produto sem SKU semelhante)", () => {
    expect(proximoSufixoNumerico("IMP-TER-80M", [])).toBe(1);
    expect(proximoSufixoNumerico("IMP-TER-80M", ["OUTRO-001"])).toBe(1);
  });

  it("retorna o proximo numero quando -001 ja existe", () => {
    expect(proximoSufixoNumerico("IMP-TER-80M", ["IMP-TER-80M-001"])).toBe(2);
  });

  it("pula para depois do maior numero quando varios ja existem em sequencia", () => {
    const existentes = Array.from({ length: 10 }, (_, i) => montarSku("IMP-TER-80M", i + 1));
    expect(proximoSufixoNumerico("IMP-TER-80M", existentes)).toBe(11);
  });

  it("nao preenche buracos: usa sempre maior+1, nunca reaproveita numero livre no meio", () => {
    expect(
      proximoSufixoNumerico("IMP-TER-80M", [
        "IMP-TER-80M-001",
        "IMP-TER-80M-002",
        "IMP-TER-80M-005",
      ]),
    ).toBe(6);
  });

  it("ignora SKUs de outra base (prefixo diferente)", () => {
    expect(proximoSufixoNumerico("IMP-TER-80M", ["ARR-INT-001", "ARR-INT-002"])).toBe(1);
  });

  it("ignora SKUs que tem a base como prefixo mas nao seguem o padrao -NNN", () => {
    expect(proximoSufixoNumerico("IMP", ["IMPRESSORA-001", "IMP-TER-80M-001"])).toBe(1);
  });

  it("e case-insensitive e tolera espacos nas extremidades (SKU digitado manualmente)", () => {
    expect(proximoSufixoNumerico("IMP-TER-80M", [" imp-ter-80m-007 "])).toBe(8);
  });

  it("lida com grande quantidade de produtos cadastrados sem limite artificial (nao trava em 99/200)", () => {
    const existentes = Array.from({ length: 5000 }, (_, i) => montarSku("PROD", i + 1));
    expect(proximoSufixoNumerico("PROD", existentes)).toBe(5001);
  });
});

describe("gerarProximoSku", () => {
  it("dois produtos com o mesmo nome geram sequencia 001 depois 002", () => {
    const primeiro = gerarProximoSku("Caneta Azul", []);
    expect(primeiro).toBe("CAN-AZU-001");
    const segundo = gerarProximoSku("Caneta Azul", [primeiro]);
    expect(segundo).toBe("CAN-AZU-002");
  });
});
