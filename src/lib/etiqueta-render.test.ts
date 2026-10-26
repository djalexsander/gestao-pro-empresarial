import { describe, expect, it } from "vitest";
import { calcularGeometriaCodigoBarras, quebrarTexto } from "./etiqueta-render";

/**
 * `quebrarTexto` usa só `ctx.font` (get/set) e `ctx.measureText(s).width`.
 * Este fake estima a largura de forma determinística (0.6 * fontPx por
 * caractere), suficiente para exercitar a lógica de quebra/redução/reticências
 * sem depender das métricas reais de fonte do canvas.
 */
function fakeCtx(charFactor = 0.6): CanvasRenderingContext2D {
  let font = "16px sans-serif";
  return {
    get font() {
      return font;
    },
    set font(v: string) {
      font = v;
    },
    measureText(s: string) {
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
      return { width: s.length * px * charFactor } as TextMetrics;
    },
  } as unknown as CanvasRenderingContext2D;
}

const NOME_CURTO = "BARBEADOR KEMEI";
const NOME_LONGO = "IMPRESSORA TERMICA DE ETIQUETAS";

function juntar(lines: string[]): string {
  return lines.join(" ").replace(/…$/, "").trim();
}

describe("quebrarTexto", () => {
  it("nome curto: mantém em 1 linha sem encolher desnecessariamente", () => {
    const ctx = fakeCtx();
    const r = quebrarTexto(ctx, NOME_CURTO, 400, "bold 24px Arial", 2);
    expect(r.lines).toEqual([NOME_CURTO]);
    expect(r.fontPx).toBe(24);
  });

  it("nome longo, maxLinhas=1: REDUZ a fonte e mantém 1 linha — sem descartar palavras, sem reticências (regressão)", () => {
    const ctx = fakeCtx();
    const r = quebrarTexto(ctx, NOME_LONGO, 320, "bold 24px Arial", 1);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).not.toContain("…");
    expect(r.lines[0]).toBe(NOME_LONGO); // todas as palavras presentes
    expect(r.fontPx).toBeLessThan(24); // fonte reduzida para caber
    // e o que sobrou realmente cabe na largura pedida
    ctx.font = `bold ${r.fontPx}px Arial`;
    expect(ctx.measureText(r.lines[0]).width).toBeLessThanOrEqual(320);
  });

  it("nome longo, maxLinhas=2: quebra em 2 linhas preservando todas as palavras", () => {
    const ctx = fakeCtx();
    const r = quebrarTexto(ctx, NOME_LONGO, 180, "bold 24px Arial", 2);
    expect(r.lines.length).toBeGreaterThanOrEqual(1);
    expect(r.lines.length).toBeLessThanOrEqual(2);
    expect(juntar(r.lines)).toBe(NOME_LONGO);
    expect(r.lines.some((l) => l.includes("…"))).toBe(false);
  });

  it("palavra única maior que a largura em qualquer fonte: cai para reticências (último recurso)", () => {
    const ctx = fakeCtx();
    const r = quebrarTexto(ctx, "SUPERCALIFRAGILISTICEXPIALIDOCIOUS", 40, "bold 24px Arial", 2);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].endsWith("…")).toBe(true);
  });

  it("texto que já cabe: retorna a fonte original intacta", () => {
    const ctx = fakeCtx();
    const r = quebrarTexto(ctx, "PROMO", 400, "bold 18px Arial", 1);
    expect(r).toEqual({ lines: ["PROMO"], fontPx: 18 });
  });
});

describe("calcularGeometriaCodigoBarras", () => {
  // Faixa típica de uma etiqueta 50x30 mm @ 203 dpi com nome + preço:
  // ~371 dots de largura útil, ~108 dots de altura para o código.
  const base = {
    larguraDisponivelDots: 371,
    alturaDisponivelDots: 108,
    dpi: 203,
    formato: "EAN13" as const,
    qtdCaracteres: 13,
  };

  it("EAN-13 @203dpi: módulo inteiro >= 3 (antes era 2 + upscale)", () => {
    const g = calcularGeometriaCodigoBarras(base);
    expect(Number.isInteger(g.moduloDots)).toBe(true);
    expect(g.moduloDots).toBeGreaterThanOrEqual(3);
  });

  it("em áreas realistas (>= ~30 mm) cabe nativamente, sem depender de reescala", () => {
    // 107 módulos EAN-13 * 2 dots (piso) + zonas de silêncio ~= 240 dots ~= 30 mm @203dpi:
    // esse é o menor tamanho físico de um EAN-13 limpo nesta resolução.
    for (const larguraDisponivelDots of [260, 297, 371, 480, 700]) {
      const g = calcularGeometriaCodigoBarras({ ...base, larguraDisponivelDots });
      expect(g.larguraTotalDots).toBeLessThanOrEqual(larguraDisponivelDots);
    }
  });

  it("área muito estreita: mantém o piso de 2 dots/módulo (o desenho depois faz o clamp p/ não vazar)", () => {
    const g = calcularGeometriaCodigoBarras({ ...base, larguraDisponivelDots: 150 });
    expect(g.moduloDots).toBe(2);
    // aqui larguraTotal > área: é limite físico — desenharCodigoBarras reduz p/ caber.
    expect(g.larguraTotalDots).toBeGreaterThan(150);
  });

  it("reserva zona de silêncio dos dois lados", () => {
    const g = calcularGeometriaCodigoBarras(base);
    expect(g.margemEsquerdaDots).toBeGreaterThan(0);
    expect(g.margemDireitaDots).toBeGreaterThan(0);
    // direita >= 7 módulos (mínimo EAN-13)
    expect(g.margemDireitaDots).toBeGreaterThanOrEqual(7 * g.moduloDots);
  });

  it("faixa realista (>= ~14 mm): barras acima dos antigos 50% e canvas previsto cabe na área (escala = 1)", () => {
    for (const alturaDisponivelDots of [110, 125, 140, 200]) {
      const g = calcularGeometriaCodigoBarras({ ...base, alturaDisponivelDots });
      expect(g.alturaBarrasDots).toBeGreaterThan(alturaDisponivelDots * 0.5);
      // barras + número + guard bar cabem na área => desenharCodigoBarras não reduz.
      expect(g.alturaTotalDots).toBeLessThanOrEqual(alturaDisponivelDots + 0.5);
    }
  });

  it("faixa alta: altura das barras é limitada por um teto físico (~22 mm)", () => {
    const g = calcularGeometriaCodigoBarras({ ...base, alturaDisponivelDots: 400 });
    expect(g.alturaBarrasDots).toBeLessThanOrEqual((22 / 25.4) * base.dpi + 1);
  });

  it("fonte do número respeita o teto do JsBarcode para EAN (width * 10)", () => {
    const g = calcularGeometriaCodigoBarras(base);
    expect(g.fonteNumeroDots).toBeLessThanOrEqual(g.moduloDots * 10);
  });

  it("DPI maior => módulo maior (a definição escala com a impressora)", () => {
    const g203 = calcularGeometriaCodigoBarras(base);
    const g300 = calcularGeometriaCodigoBarras({
      ...base,
      larguraDisponivelDots: 548,
      alturaDisponivelDots: 160,
      dpi: 300,
    });
    expect(g300.moduloDots).toBeGreaterThan(g203.moduloDots);
  });

  it("área minúscula: aplica o piso de 2 dots/módulo", () => {
    const g = calcularGeometriaCodigoBarras({ ...base, larguraDisponivelDots: 60 });
    expect(g.moduloDots).toBe(2);
  });

  it("CODE128 (código não-EAN): largura escala com o nº de caracteres", () => {
    const curto = calcularGeometriaCodigoBarras({
      ...base,
      formato: "CODE128",
      qtdCaracteres: 6,
      larguraDisponivelDots: 700,
    });
    const longo = calcularGeometriaCodigoBarras({
      ...base,
      formato: "CODE128",
      qtdCaracteres: 24,
      larguraDisponivelDots: 700,
    });
    expect(longo.larguraTotalDots).toBeGreaterThan(curto.larguraTotalDots);
    expect(longo.larguraTotalDots).toBeLessThanOrEqual(700);
  });
});
