import assert from "node:assert/strict";
import test from "node:test";
import {
  adicionarMesesFinanceiros,
  gerarParcelasFiado,
  somaParcelasCentavos,
} from "./parcelamento-fiado.ts";

test("R$ 600,00 em 1 parcela", () => {
  const parcelas = gerarParcelasFiado(600, 1, "2026-08-14");
  assert.deepEqual(parcelas.map((p) => p.valorCentavos), [60_000]);
});

test("R$ 600,00 em 3 parcelas", () => {
  const parcelas = gerarParcelasFiado(600, 3, "2026-08-14");
  assert.deepEqual(parcelas.map((p) => p.valorCentavos), [20_000, 20_000, 20_000]);
  assert.deepEqual(parcelas.map((p) => p.dataVencimento), ["2026-08-14", "2026-09-14", "2026-10-14"]);
});

test("R$ 100,00 em 3 parcelas aplica o resto na última", () => {
  const parcelas = gerarParcelasFiado(100, 3, "2026-08-14");
  assert.deepEqual(parcelas.map((p) => p.valorCentavos), [3_333, 3_333, 3_334]);
  assert.equal(somaParcelasCentavos(parcelas), 10_000);
});

test("pagamento misto parcela somente os R$ 600,00 do fiado", () => {
  const pixCentavos = 40_000;
  const parcelas = gerarParcelasFiado(600, 3, "2026-08-14");
  assert.equal(somaParcelasCentavos(parcelas), 60_000);
  assert.equal(pixCentavos + somaParcelasCentavos(parcelas), 100_000);
});

test("preserva o dia original após fevereiro de 2026", () => {
  assert.equal(adicionarMesesFinanceiros("2026-01-31", 1), "2026-02-28");
  assert.equal(adicionarMesesFinanceiros("2026-01-31", 2), "2026-03-31");
});

test("preserva o dia original em ano bissexto", () => {
  assert.equal(adicionarMesesFinanceiros("2028-01-31", 1), "2028-02-29");
  assert.equal(adicionarMesesFinanceiros("2028-01-31", 2), "2028-03-31");
});

test("rejeita quantidade inválida", () => {
  for (const quantidade of [0, -1, 1.5, 61]) {
    assert.throws(() => gerarParcelasFiado(100, quantidade, "2026-08-14"));
  }
});

test("mantém soma exata em centavos de 1 a 60 parcelas", () => {
  for (let quantidade = 1; quantidade <= 60; quantidade += 1) {
    const parcelas = gerarParcelasFiado(123.47, quantidade, "2026-01-31");
    assert.equal(somaParcelasCentavos(parcelas), 12_347);
  }
});
