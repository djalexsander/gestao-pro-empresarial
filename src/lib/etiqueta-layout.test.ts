import { describe, expect, it } from "vitest";
import {
  calcularGrade,
  criarPerfil,
  dimensoesEfetivas,
  dotsParaMm,
  mmParaDots,
  paginarItens,
  resolveDpi,
  validarPerfil,
  type PerfilBobina,
} from "./etiqueta-layout";

describe("mm <-> dots", () => {
  it("converte mm para dots considerando o DPI (dots = mm / 25.4 * dpi)", () => {
    expect(mmParaDots(25.4, 203)).toBe(203);
    expect(mmParaDots(25.4, 300)).toBe(300);
    expect(mmParaDots(50, 203)).toBe(Math.round((50 / 25.4) * 203));
  });

  it("dotsParaMm é o inverso aproximado de mmParaDots", () => {
    const dpi = 300;
    const mm = 40;
    const dots = mmParaDots(mm, dpi);
    expect(dotsParaMm(dots, dpi)).toBeCloseTo(mm, 0);
  });
});

describe("resolveDpi", () => {
  it("usa 203 quando modo = 203, ignorando DPI consultado", () => {
    const perfil = criarPerfil({ dpi: { modo: "203" } });
    expect(resolveDpi(perfil, 300)).toBe(203);
  });

  it("usa 300 quando modo = 300", () => {
    const perfil = criarPerfil({ dpi: { modo: "300" } });
    expect(resolveDpi(perfil)).toBe(300);
  });

  it("usa o valor personalizado quando modo = custom, clampado em [72, 1200]", () => {
    expect(resolveDpi(criarPerfil({ dpi: { modo: "custom", personalizado: 400 } }))).toBe(400);
    expect(resolveDpi(criarPerfil({ dpi: { modo: "custom", personalizado: 10 } }))).toBe(72);
    expect(resolveDpi(criarPerfil({ dpi: { modo: "custom", personalizado: 5000 } }))).toBe(1200);
  });

  it("modo automático usa o DPI consultado da impressora quando disponível", () => {
    const perfil = criarPerfil({ dpi: { modo: "auto" } });
    expect(resolveDpi(perfil, 300)).toBe(300);
  });

  it("modo automático cai para o fallback quando não há impressora/consulta", () => {
    const perfil = criarPerfil({ dpi: { modo: "auto" } });
    expect(resolveDpi(perfil, null)).toBe(203);
    expect(resolveDpi(perfil, undefined)).toBe(203);
    expect(resolveDpi(perfil, 0)).toBe(203);
  });

  it("o tamanho físico (proporção largura/altura em dots) não muda entre DPIs", () => {
    const perfil = criarPerfil({ larguraEtiquetaMm: 50, alturaEtiquetaMm: 30 });
    for (const dpi of [203, 300, 600]) {
      const w = mmParaDots(perfil.larguraEtiquetaMm, dpi);
      const h = mmParaDots(perfil.alturaEtiquetaMm, dpi);
      expect(w / h).toBeCloseTo(50 / 30, 1);
    }
  });
});

describe("orientação", () => {
  it("retrato mantém largura/altura como configuradas", () => {
    const perfil = criarPerfil({
      larguraEtiquetaMm: 50,
      alturaEtiquetaMm: 30,
      orientacao: "retrato",
    });
    expect(dimensoesEfetivas(perfil)).toEqual({ larguraMm: 50, alturaMm: 30 });
  });

  it("paisagem troca largura e altura efetivas", () => {
    const perfil = criarPerfil({
      larguraEtiquetaMm: 30,
      alturaEtiquetaMm: 50,
      orientacao: "paisagem",
    });
    expect(dimensoesEfetivas(perfil)).toEqual({ larguraMm: 50, alturaMm: 30 });
  });

  it("uma etiqueta 30x50 em paisagem produz a mesma grade que 50x30 em retrato", () => {
    const paisagem = criarPerfil({
      larguraEtiquetaMm: 30,
      alturaEtiquetaMm: 50,
      orientacao: "paisagem",
      larguraMidiaMm: 50,
    });
    const retrato = criarPerfil({
      larguraEtiquetaMm: 50,
      alturaEtiquetaMm: 30,
      orientacao: "retrato",
      larguraMidiaMm: 50,
    });
    expect(calcularGrade(paisagem)).toEqual(calcularGrade(retrato));
  });
});

describe("calcularGrade — colunas", () => {
  function perfilColunas(colunas: number, overrides: Partial<PerfilBobina> = {}): PerfilBobina {
    return criarPerfil({
      larguraEtiquetaMm: 40,
      alturaEtiquetaMm: 27,
      colunas,
      gapHorizontalMm: 2,
      gapVerticalMm: 3,
      margemEsquerdaMm: 1,
      margemDireitaMm: 1,
      margemSuperiorMm: 0.5,
      margemInferiorMm: 0.5,
      larguraMidiaMm: 1 + 40 * colunas + 2 * (colunas - 1) + 1,
      ...overrides,
    });
  }

  it("1 coluna produz uma única célula", () => {
    const grade = calcularGrade(perfilColunas(1));
    expect(grade.colunas).toBe(1);
    expect(grade.celulas).toHaveLength(1);
    expect(grade.celulas[0].xMm).toBeCloseTo(1, 5);
  });

  it("2 colunas produz duas células lado a lado, com gap entre elas", () => {
    const grade = calcularGrade(perfilColunas(2));
    expect(grade.colunas).toBe(2);
    expect(grade.celulas).toHaveLength(2);
    const [c0, c1] = grade.celulas;
    expect(c0.xMm).toBeCloseTo(1, 5);
    // c1.x = margem + largura + gap
    expect(c1.xMm).toBeCloseTo(1 + 40 + 2, 5);
  });

  it("3+ colunas encadeia largura+gap para cada coluna subsequente", () => {
    const grade = calcularGrade(perfilColunas(3));
    expect(grade.colunas).toBe(3);
    const xs = grade.celulas.map((c) => c.xMm);
    expect(xs[0]).toBeCloseTo(1, 5);
    expect(xs[1]).toBeCloseTo(1 + 42, 5);
    expect(xs[2]).toBeCloseTo(1 + 42 * 2, 5);
  });

  it("altura da linha inclui margens verticais + gap vertical", () => {
    const grade = calcularGrade(perfilColunas(2));
    expect(grade.alturaLinhaMm).toBeCloseTo(0.5 + 27 + 0.5 + 3, 5);
  });

  it("gap horizontal zero encosta as colunas sem espaçamento", () => {
    const grade = calcularGrade(
      perfilColunas(2, { gapHorizontalMm: 0, larguraMidiaMm: 1 + 80 + 1 }),
    );
    expect(grade.celulas[1].xMm - grade.celulas[0].xMm).toBeCloseTo(40, 5);
  });

  it("margens deslocam a primeira célula", () => {
    const grade = calcularGrade(
      perfilColunas(1, { margemEsquerdaMm: 5, margemSuperiorMm: 4, larguraMidiaMm: 46 }),
    );
    expect(grade.celulas[0].xMm).toBeCloseTo(5, 5);
    expect(grade.celulas[0].yMm).toBeCloseTo(4, 5);
  });
});

describe("calibração (offset)", () => {
  it("offset positivo desloca as células para a direita/baixo", () => {
    const base = criarPerfil({ larguraMidiaMm: 50, offsetXMm: 1, offsetYMm: 0.5 });
    const grade = calcularGrade(base);
    expect(grade.celulas[0].xMm).toBeCloseTo(1, 5);
    expect(grade.celulas[0].yMm).toBeCloseTo(0.5, 5);
  });

  it("offset negativo desloca as células para a esquerda/cima", () => {
    const base = criarPerfil({ larguraMidiaMm: 50, offsetXMm: -1.5, offsetYMm: -0.8 });
    const grade = calcularGrade(base);
    expect(grade.celulas[0].xMm).toBeCloseTo(-1.5, 5);
    expect(grade.celulas[0].yMm).toBeCloseTo(-0.8, 5);
  });

  it("offset não entra na validação de largura da mídia", () => {
    const perfil = criarPerfil({ larguraEtiquetaMm: 50, larguraMidiaMm: 50, offsetXMm: 40 });
    expect(validarPerfil(perfil).ok).toBe(true);
  });
});

describe("validarPerfil — largura excedida", () => {
  it("aceita quando a soma exata cabe na mídia", () => {
    const perfil = criarPerfil({
      larguraEtiquetaMm: 40,
      colunas: 2,
      gapHorizontalMm: 2,
      margemEsquerdaMm: 1,
      margemDireitaMm: 1,
      larguraMidiaMm: 1 + 40 * 2 + 2 + 1,
    });
    const resultado = validarPerfil(perfil);
    expect(resultado.ok).toBe(true);
    expect(resultado.larguraNecessariaMm).toBeCloseTo(84, 5);
  });

  it("rejeita e explica quando ultrapassa a largura da mídia", () => {
    const perfil = criarPerfil({
      larguraEtiquetaMm: 50,
      colunas: 2,
      gapHorizontalMm: 2,
      margemEsquerdaMm: 0,
      margemDireitaMm: 0,
      larguraMidiaMm: 90,
    });
    const resultado = validarPerfil(perfil);
    expect(resultado.ok).toBe(false);
    expect(resultado.mensagem).toContain("ultrapassam a largura da mídia");
    expect(resultado.larguraNecessariaMm).toBeCloseTo(102, 5);
  });

  it("rejeita dimensões zeradas ou negativas", () => {
    expect(validarPerfil(criarPerfil({ larguraEtiquetaMm: 0 })).ok).toBe(false);
    expect(validarPerfil(criarPerfil({ gapHorizontalMm: -1 })).ok).toBe(false);
    expect(validarPerfil(criarPerfil({ margemEsquerdaMm: -1 })).ok).toBe(false);
  });

  it("rejeita quando a largura da mídia não é positiva", () => {
    expect(validarPerfil(criarPerfil({ larguraMidiaMm: 0 })).ok).toBe(false);
  });
});

describe("tamanhos usuais e personalizados", () => {
  it("40x27 mm em 2 colunas é um layout válido comum de bobina dupla", () => {
    const perfil = criarPerfil({
      nome: "40x27 2 colunas",
      larguraEtiquetaMm: 40,
      alturaEtiquetaMm: 27,
      colunas: 2,
      gapHorizontalMm: 2,
      margemEsquerdaMm: 1,
      margemDireitaMm: 1,
      larguraMidiaMm: 84,
    });
    expect(validarPerfil(perfil).ok).toBe(true);
    expect(calcularGrade(perfil).colunas).toBe(2);
  });

  it("50x30 mm em 1 coluna continua funcionando (compat com formato legado)", () => {
    const perfil = criarPerfil({
      larguraEtiquetaMm: 50,
      alturaEtiquetaMm: 30,
      colunas: 1,
      larguraMidiaMm: 50,
    });
    expect(validarPerfil(perfil).ok).toBe(true);
  });

  it("tamanho totalmente personalizado (ex.: 73x21mm, 3 colunas) é aceito sem hardcode", () => {
    const perfil = criarPerfil({
      larguraEtiquetaMm: 73,
      alturaEtiquetaMm: 21,
      colunas: 3,
      gapHorizontalMm: 1.5,
      margemEsquerdaMm: 2,
      margemDireitaMm: 2,
      larguraMidiaMm: 2 + 73 * 3 + 1.5 * 2 + 2,
    });
    expect(validarPerfil(perfil).ok).toBe(true);
  });
});

describe("paginarItens", () => {
  it("1 coluna: cada item vira sua própria linha", () => {
    expect(paginarItens(["A", "B", "C"], 1)).toEqual([["A"], ["B"], ["C"]]);
  });

  it("2 colunas com quantidade par preenche todas as linhas", () => {
    expect(paginarItens(["A", "B", "C", "D"], 2)).toEqual([
      ["A", "B"],
      ["C", "D"],
    ]);
  });

  it("2 colunas com quantidade ímpar deixa null na última posição (não estica o item)", () => {
    expect(paginarItens(["A", "B", "C"], 2)).toEqual([
      ["A", "B"],
      ["C", null],
    ]);
  });

  it("3+ colunas distribui e preenche o resto da última linha com null", () => {
    expect(paginarItens(["A", "B", "C", "D", "E"], 3)).toEqual([
      ["A", "B", "C"],
      ["D", "E", null],
    ]);
  });

  it("lista vazia não produz linhas", () => {
    expect(paginarItens([], 2)).toEqual([]);
  });

  it("colunas fracionárias/zeradas são tratadas como 1", () => {
    expect(paginarItens(["A", "B"], 0)).toEqual([["A"], ["B"]]);
  });
});
