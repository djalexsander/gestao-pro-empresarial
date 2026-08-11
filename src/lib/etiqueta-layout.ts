/**
 * Motor central de layout de etiquetas/bobinas.
 *
 * Único lugar do Gestão Pro que sabe transformar um "perfil de bobina"
 * (dimensões em mm, colunas, gaps, margens, orientação, DPI, offset) em uma
 * grade física de células. Usado tanto pela impressão real quanto pelo
 * preview — nenhuma tela deve recalcular isso por conta própria.
 *
 * Genérico por design: não conhece fabricante/modelo de impressora (TSC,
 * Zebra, Argox, LABEL…) nem assume 1 etiqueta por linha. Tudo é derivado
 * dos campos do perfil.
 */

export type OrientacaoEtiqueta = "retrato" | "paisagem";
export type ModoDpi = "auto" | "203" | "300" | "custom";

export interface DpiConfig {
  modo: ModoDpi;
  /** Usado apenas quando `modo === "custom"`. Clampado em [DPI_MIN, DPI_MAX]. */
  personalizado?: number;
}

export interface PerfilBobina {
  id: string;
  nome: string;
  larguraEtiquetaMm: number;
  alturaEtiquetaMm: number;
  /** Quantidade de etiquetas lado a lado (colunas) na bobina. Mínimo 1. */
  colunas: number;
  gapHorizontalMm: number;
  gapVerticalMm: number;
  margemEsquerdaMm: number;
  margemDireitaMm: number;
  margemSuperiorMm: number;
  margemInferiorMm: number;
  orientacao: OrientacaoEtiqueta;
  /** Largura total da mídia/bobina em mm (todas as colunas + gaps + margens). */
  larguraMidiaMm: number;
  /** Calibração fina — não entra na validação de largura. */
  offsetXMm: number;
  offsetYMm: number;
  dpi: DpiConfig;
  /** Apenas um perfil pode ser padrão por vez (aplicado por `definirPadrao`). */
  padrao: boolean;
  criadoEm: number;
  atualizadoEm: number;
}

export const DPI_PADRAO_FALLBACK = 203;
export const DPI_MIN = 72;
export const DPI_MAX = 1200;

const EPSILON_MM = 0.01;

function clamp(valor: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valor));
}

export function gerarIdPerfil(): string {
  return `bob-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

/** Cria um perfil com valores sensatos (50×30 mm, 1 coluna), sobrescrevível. */
export function criarPerfil(overrides: Partial<PerfilBobina> = {}): PerfilBobina {
  const agora = Date.now();
  const base: PerfilBobina = {
    id: gerarIdPerfil(),
    nome: "Novo perfil",
    larguraEtiquetaMm: 50,
    alturaEtiquetaMm: 30,
    colunas: 1,
    gapHorizontalMm: 2,
    gapVerticalMm: 2,
    margemEsquerdaMm: 0,
    margemDireitaMm: 0,
    margemSuperiorMm: 0,
    margemInferiorMm: 0,
    orientacao: "retrato",
    larguraMidiaMm: 50,
    offsetXMm: 0,
    offsetYMm: 0,
    dpi: { modo: "auto" },
    padrao: false,
    criadoEm: agora,
    atualizadoEm: agora,
  };
  return { ...base, ...overrides };
}

/** Largura/altura efetivas após aplicar a orientação (paisagem troca os eixos). */
export function dimensoesEfetivas(perfil: PerfilBobina): { larguraMm: number; alturaMm: number } {
  if (perfil.orientacao === "paisagem") {
    return { larguraMm: perfil.alturaEtiquetaMm, alturaMm: perfil.larguraEtiquetaMm };
  }
  return { larguraMm: perfil.larguraEtiquetaMm, alturaMm: perfil.alturaEtiquetaMm };
}

/**
 * Resolve o DPI efetivo de renderização.
 *
 * "Automático" usa o DPI relatado pelo driver da impressora quando
 * disponível (`dpiConsultado`, obtido via WinAPI/GDI) e cai para
 * `DPI_PADRAO_FALLBACK` quando não há impressora/driver disponível (web,
 * preview sem impressora selecionada, ou consulta que falhou).
 */
export function resolveDpi(perfil: PerfilBobina, dpiConsultado?: number | null): number {
  switch (perfil.dpi.modo) {
    case "203":
      return 203;
    case "300":
      return 300;
    case "custom":
      return clamp(Math.round(perfil.dpi.personalizado ?? DPI_PADRAO_FALLBACK), DPI_MIN, DPI_MAX);
    case "auto":
    default:
      if (dpiConsultado && dpiConsultado > 0) {
        return clamp(Math.round(dpiConsultado), DPI_MIN, DPI_MAX);
      }
      return DPI_PADRAO_FALLBACK;
  }
}

/** mm → dots (pixels), considerando o DPI efetivo. `dots = mm / 25.4 * dpi`. */
export function mmParaDots(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

export function dotsParaMm(dots: number, dpi: number): number {
  return (dots / dpi) * 25.4;
}

export interface CelulaGrade {
  coluna: number;
  xMm: number;
  yMm: number;
  larguraMm: number;
  alturaMm: number;
}

export interface GradeBobina {
  colunas: number;
  /** Largura da "linha" (uma página física enviada à impressora) em mm. */
  larguraLinhaMm: number;
  /** Altura da "linha" em mm — inclui margens verticais + gap vertical. */
  alturaLinhaMm: number;
  celulas: CelulaGrade[];
}

/**
 * Calcula a grade de células (posições X/Y de cada coluna) para UMA linha da
 * bobina. Cada linha impressa vira uma página GDI própria — o avanço entre
 * linhas é físico (rolo contínuo), por isso não há paginação vertical aqui.
 */
export function calcularGrade(perfil: PerfilBobina): GradeBobina {
  const { larguraMm: larguraEtiqueta, alturaMm: alturaEtiqueta } = dimensoesEfetivas(perfil);
  const colunas = Math.max(1, Math.round(perfil.colunas || 1));

  const celulas: CelulaGrade[] = [];
  for (let coluna = 0; coluna < colunas; coluna++) {
    const xMm =
      perfil.margemEsquerdaMm +
      perfil.offsetXMm +
      coluna * (larguraEtiqueta + perfil.gapHorizontalMm);
    const yMm = perfil.margemSuperiorMm + perfil.offsetYMm;
    celulas.push({ coluna, xMm, yMm, larguraMm: larguraEtiqueta, alturaMm: alturaEtiqueta });
  }

  const alturaLinhaMm =
    perfil.margemSuperiorMm + alturaEtiqueta + perfil.margemInferiorMm + perfil.gapVerticalMm;

  return {
    colunas,
    larguraLinhaMm: perfil.larguraMidiaMm,
    alturaLinhaMm,
    celulas,
  };
}

/**
 * Largura física necessária para o layout nominal (sem offset/calibração):
 * margem esquerda + (largura etiqueta × colunas) + gaps horizontais + margem
 * direita. Usada pela validação e por atalhos de UI (ex.: "preencher largura
 * da mídia automaticamente").
 */
export function calcularLarguraNecessariaMm(perfil: PerfilBobina): number {
  const colunas = Math.max(1, Math.round(perfil.colunas || 1));
  const { larguraMm: larguraEtiqueta } = dimensoesEfetivas(perfil);
  return (
    perfil.margemEsquerdaMm +
    larguraEtiqueta * colunas +
    perfil.gapHorizontalMm * Math.max(0, colunas - 1) +
    perfil.margemDireitaMm
  );
}

export interface ResultadoValidacaoPerfil {
  ok: boolean;
  mensagem?: string;
  larguraNecessariaMm?: number;
}

/**
 * Valida se o layout configurado cabe fisicamente na mídia. Segue
 * exatamente a fórmula: margem esquerda + (largura etiqueta × colunas) +
 * gaps horizontais + margem direita ≤ largura da mídia.
 *
 * Offset/calibração é intencionalmente EXCLUÍDO desta validação: é um
 * ajuste fino (±poucos mm) para compensar imprecisão mecânica, não faz
 * parte do dimensionamento nominal do layout.
 */
export function validarPerfil(perfil: PerfilBobina): ResultadoValidacaoPerfil {
  const colunas = Math.max(1, Math.round(perfil.colunas || 1));
  const { larguraMm: larguraEtiqueta, alturaMm: alturaEtiqueta } = dimensoesEfetivas(perfil);

  if (!(larguraEtiqueta > 0) || !(alturaEtiqueta > 0)) {
    return { ok: false, mensagem: "Largura e altura da etiqueta devem ser maiores que zero." };
  }
  if (!(perfil.larguraMidiaMm > 0)) {
    return { ok: false, mensagem: "Informe a largura total da mídia/bobina." };
  }
  if (!Number.isFinite(colunas) || colunas < 1) {
    return { ok: false, mensagem: "A quantidade de colunas deve ser pelo menos 1." };
  }

  const camposNaoNegativos: Array<[string, number]> = [
    ["gap horizontal", perfil.gapHorizontalMm],
    ["gap vertical", perfil.gapVerticalMm],
    ["margem esquerda", perfil.margemEsquerdaMm],
    ["margem direita", perfil.margemDireitaMm],
    ["margem superior", perfil.margemSuperiorMm],
    ["margem inferior", perfil.margemInferiorMm],
  ];
  for (const [campo, valor] of camposNaoNegativos) {
    if (!Number.isFinite(valor) || valor < 0) {
      return { ok: false, mensagem: `O campo "${campo}" não pode ser negativo.` };
    }
  }

  const larguraNecessariaMm = calcularLarguraNecessariaMm(perfil);

  if (larguraNecessariaMm > perfil.larguraMidiaMm + EPSILON_MM) {
    return {
      ok: false,
      mensagem:
        `As dimensões configuradas ultrapassam a largura da mídia ` +
        `(necessário ${larguraNecessariaMm.toFixed(1)} mm, disponível ${perfil.larguraMidiaMm.toFixed(1)} mm).`,
      larguraNecessariaMm,
    };
  }

  const alturaUtilMm = perfil.margemSuperiorMm + alturaEtiqueta + perfil.margemInferiorMm;
  if (alturaUtilMm <= 0) {
    return {
      ok: false,
      mensagem: "As margens superior/inferior anulam a altura útil da etiqueta.",
    };
  }

  return { ok: true, larguraNecessariaMm };
}

/**
 * Distribui uma lista de itens em linhas de `colunas` itens cada. A última
 * linha é preenchida com `null` nas posições vazias (não estica os itens
 * restantes para ocupar a largura toda).
 */
export function paginarItens<T>(itens: T[], colunas: number): Array<Array<T | null>> {
  const cols = Math.max(1, Math.round(colunas || 1));
  if (itens.length === 0) return [];
  const linhas: Array<Array<T | null>> = [];
  for (let i = 0; i < itens.length; i += cols) {
    const linha: Array<T | null> = itens.slice(i, i + cols);
    while (linha.length < cols) linha.push(null);
    linhas.push(linha);
  }
  return linhas;
}

export function formatarResumoPerfil(perfil: PerfilBobina): string {
  const colunas = Math.max(1, Math.round(perfil.colunas || 1));
  const sufixoColunas = colunas === 1 ? "1 coluna" : `${colunas} colunas`;
  return `${perfil.larguraEtiquetaMm}×${perfil.alturaEtiquetaMm} mm · ${sufixoColunas}`;
}
