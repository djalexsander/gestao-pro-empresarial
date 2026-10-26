/**
 * Renderização compartilhada de folhas de etiqueta (linha da bobina = 1
 * página). Usa exclusivamente `calcularGrade`/`resolveDpi`/`paginarItens`
 * de `@/lib/etiqueta-layout` — é o único lugar que transforma uma grade +
 * lista de itens em PNGs, para que impressão real e preview NUNCA
 * divirjam (mesma função, mesmo resultado).
 *
 * O desenho do CONTEÚDO de cada célula (nome, preço, código de barras…) é
 * responsabilidade de quem chama (`desenharCelula`), porque cada tela do
 * Gestão Pro mostra campos diferentes — só a matemática de grade/DPI/PNG é
 * centralizada aqui.
 */

import JsBarcode from "jsbarcode";

import {
  calcularGrade,
  mmParaDots,
  paginarItens,
  resolveDpi,
  type CelulaGrade,
  type GradeBobina,
  type PerfilBobina,
} from "./etiqueta-layout";

export interface CelulaRenderContext {
  ctx: CanvasRenderingContext2D;
  /** Posição/tamanho da célula dentro do canvas da linha, em dots (px). */
  xDots: number;
  yDots: number;
  larguraDots: number;
  alturaDots: number;
  dpi: number;
  coluna: number;
  celula: CelulaGrade;
}

export type DesenharCelula<T> = (
  contexto: CelulaRenderContext,
  item: T | null,
) => void | Promise<void>;

export interface RenderizarFolhasOpts<T> {
  perfil: PerfilBobina;
  itens: T[];
  /** DPI já consultado do driver (modo Automático) — `null`/omitido usa o fallback. */
  dpiConsultado?: number | null;
  desenharCelula: DesenharCelula<T>;
}

export interface FolhaRenderizada {
  png: Uint8Array;
  larguraDots: number;
  alturaDots: number;
}

/** Cria um canvas e devolve PNG bytes — única conversão canvas→PNG do módulo. */
export function canvasParaPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("toBlob retornou null"));
        return;
      }
      blob
        .arrayBuffer()
        .then((buf) => resolve(new Uint8Array(buf)))
        .catch(reject);
    }, "image/png");
  });
}

function criarCanvasLinha(
  grade: GradeBobina,
  dpi: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const larguraDots = Math.max(1, mmParaDots(grade.larguraLinhaMm, dpi));
  const alturaDots = Math.max(1, mmParaDots(grade.alturaLinhaMm, dpi));
  const canvas = document.createElement("canvas");
  canvas.width = larguraDots;
  canvas.height = alturaDots;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D indisponível");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  // Fundamental para barras de código de barras nítidas em impressão térmica.
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

async function renderizarLinha<T>(
  grade: GradeBobina,
  dpi: number,
  itensLinha: Array<T | null>,
  desenharCelula: DesenharCelula<T>,
): Promise<FolhaRenderizada> {
  const { canvas, ctx } = criarCanvasLinha(grade, dpi);

  for (let i = 0; i < grade.celulas.length; i++) {
    const celula = grade.celulas[i];
    const item = itensLinha[i] ?? null;
    const xDots = mmParaDots(celula.xMm, dpi);
    const yDots = mmParaDots(celula.yMm, dpi);
    const larguraDots = mmParaDots(celula.larguraMm, dpi);
    const alturaDots = mmParaDots(celula.alturaMm, dpi);

    ctx.save();
    // Recorta a célula: mesmo com offset/calibração imperfeito, conteúdo
    // nunca vaza para a coluna vizinha.
    ctx.beginPath();
    ctx.rect(xDots, yDots, larguraDots, alturaDots);
    ctx.clip();
    ctx.fillStyle = "#000000";
    ctx.imageSmoothingEnabled = false;

    await desenharCelula(
      { ctx, xDots, yDots, larguraDots, alturaDots, dpi, coluna: celula.coluna, celula },
      item,
    );
    ctx.restore();
  }

  const png = await canvasParaPng(canvas);
  return { png, larguraDots: canvas.width, alturaDots: canvas.height };
}

/**
 * Motor único de renderização: perfil + itens → 1 PNG por linha da bobina.
 * Mesma função usada pelo preview (desenhada num canvas visível, em
 * escala) e pela impressão real (enviada via `printLabelSheet`).
 */
export async function renderizarFolhas<T>(
  opts: RenderizarFolhasOpts<T>,
): Promise<FolhaRenderizada[]> {
  const { perfil, itens, dpiConsultado, desenharCelula } = opts;
  const grade = calcularGrade(perfil);
  const dpi = resolveDpi(perfil, dpiConsultado);
  const linhas = paginarItens(itens, grade.colunas);
  const folhas: FolhaRenderizada[] = [];
  for (const linha of linhas) {
    folhas.push(await renderizarLinha(grade, dpi, linha, desenharCelula));
  }
  return folhas;
}

/**
 * Conteúdo de teste/calibração: desenha "TESTE ETIQUETA", a coluna (1-based)
 * e as dimensões do perfil. Cada coluna recebe um número diferente — é o
 * que permite calibrar visualmente um perfil de 2+ colunas (ver seção de
 * impressão de teste nas Configurações → Impressoras).
 */
export function desenharConteudoTeste(contexto: CelulaRenderContext, perfil: PerfilBobina): void {
  const { ctx, xDots, yDots, larguraDots, alturaDots, dpi, coluna } = contexto;
  const mm = (v: number) => mmParaDots(v, dpi);
  const cx = xDots + larguraDots / 2;
  const maxWidth = Math.max(1, larguraDots * 0.92);

  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const linha1Font = Math.max(mm(2), Math.min(mm(4), alturaDots * 0.16));
  const linha2Font = Math.max(mm(1.6), Math.min(mm(3), alturaDots * 0.12));
  const passo = linha2Font * 1.35;

  let y = yDots + Math.max(mm(1), alturaDots * 0.08);
  ctx.font = `bold ${Math.round(linha1Font)}px Arial, sans-serif`;
  ctx.fillText("TESTE ETIQUETA", cx, y, maxWidth);
  y += linha1Font * 1.3;

  ctx.font = `${Math.round(linha2Font)}px Arial, sans-serif`;
  ctx.fillText(`Coluna ${coluna + 1}`, cx, y, maxWidth);
  y += passo;
  ctx.fillText(`${perfil.larguraEtiquetaMm}×${perfil.alturaEtiquetaMm} mm`, cx, y, maxWidth);
  y += passo;
  ctx.fillText(`${dpi} dpi`, cx, y, maxWidth);
  y += passo;
  ctx.fillText(new Date().toLocaleTimeString("pt-BR"), cx, y, maxWidth);

  ctx.lineWidth = Math.max(1, mm(0.3));
  ctx.strokeStyle = "#000000";
  ctx.strokeRect(
    xDots + ctx.lineWidth,
    yDots + ctx.lineWidth,
    larguraDots - ctx.lineWidth * 2,
    alturaDots - ctx.lineWidth * 2,
  );
}

/**
 * Quebra um texto em até `maxLinhas` linhas que caibam em `maxWidth`. Se
 * mesmo em `maxLinhas` linhas o texto não couber, reduz a fonte
 * progressivamente e, em último caso, trunca com reticências.
 *
 * Compartilhado entre todas as telas que desenham etiquetas (produto,
 * prateleira, personalizada, teste) — antes duplicado byte-a-byte em cada
 * uma.
 */
export function quebrarTexto(
  ctx: CanvasRenderingContext2D,
  texto: string,
  maxWidth: number,
  fontCss: string,
  maxLinhas: number,
): { lines: string[]; fontPx: number } {
  const match = /(\d+(?:\.\d+)?)px/.exec(fontCss);
  const baseFamily = fontCss.replace(/\d+(?:\.\d+)?px/, "FX");
  const aplicarFonte = (px: number) => {
    ctx.font = baseFamily.replace("FX", `${Math.round(px)}px`);
  };

  // Tenta caber o texto INTEIRO em <= maxLinhas, reduzindo a fonte a cada
  // tentativa. Só cai para reticências quando nem na menor fonte testada o
  // texto coube sem descartar palavras — nunca "some" com o fim do nome.
  let fontPx = match ? Number(match[1]) : 16;
  for (let tentativa = 0; tentativa < 8; tentativa++) {
    aplicarFonte(fontPx);
    const palavras = texto.split(/\s+/).filter(Boolean);
    const linhas: string[] = [];
    let atual = "";
    for (const p of palavras) {
      const probe = atual ? `${atual} ${p}` : p;
      // `!atual` garante que uma palavra sozinha maior que maxWidth ainda
      // entre numa linha (será detectada como "não coube" logo abaixo).
      if (!atual || ctx.measureText(probe).width <= maxWidth) {
        atual = probe;
      } else {
        linhas.push(atual);
        atual = p;
      }
    }
    if (atual) linhas.push(atual);

    const coube =
      linhas.length > 0 &&
      linhas.length <= maxLinhas &&
      linhas.every((l) => ctx.measureText(l).width <= maxWidth);
    if (coube) return { lines: linhas, fontPx: Math.round(fontPx) };
    fontPx *= 0.9;
  }

  // Último recurso: 1 linha truncada com reticências, na menor fonte testada.
  aplicarFonte(fontPx);
  let s = texto;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) {
    s = s.slice(0, -1);
  }
  return { lines: [s + "…"], fontPx: Math.round(fontPx) };
}

/* ========================================================================== */
/* Código de barras — geometria + desenho compartilhados                       */
/* -------------------------------------------------------------------------- */
/* O código é gerado pelo JsBarcode JÁ no tamanho final (módulos inteiros +    */
/* zona de silêncio real) e desenhado 1:1 no canvas da etiqueta. Nunca é um    */
/* raster pequeno esticado depois — isso preservava proporção ruim e barras    */
/* borradas na térmica.                                                        */
/* ========================================================================== */

export type FormatoCodigoBarras = "EAN13" | "CODE128";

/**
 * Geometria de um código de barras dentro de uma área da etiqueta, tudo em
 * dots (px na resolução de impressão). Os campos alimentam diretamente as
 * opções do JsBarcode (`width`, `height`, `marginLeft/Right`, `fontSize`).
 */
export interface GeometriaCodigoBarras {
  /** Largura de 1 módulo (barra fina), em dots. Inteiro, >= 2. */
  moduloDots: number;
  /** Zona de silêncio à esquerda, em dots. */
  margemEsquerdaDots: number;
  /** Zona de silêncio à direita, em dots. */
  margemDireitaDots: number;
  /** Altura das barras, em dots. */
  alturaBarrasDots: number;
  /** Corpo da fonte do número sob as barras, em dots. */
  fonteNumeroDots: number;
  /** Largura total prevista do canvas gerado (barras + zonas de silêncio). */
  larguraTotalDots: number;
  /** Altura total prevista do canvas gerado (barras + número). */
  alturaTotalDots: number;
}

// EAN-13 no JsBarcode (não-flat): 12 módulos da área do 1º dígito + 95 do
// símbolo guardado. Zona de silêncio: a área do 1º dígito já cobre boa parte
// da esquerda (spec: 11 módulos); reforçamos 2. À direita a spec pede >= 7 —
// hoje era 0. Usamos 9 para folga de leitura.
const EAN13_MODULOS_SIMBOLO = 107;
const EAN13_QZ_ESQUERDA_MODULOS = 2;
const EAN13_QZ_DIREITA_MODULOS = 9;
// CODE128: largura varia com o dado (~11 módulos/char + start+checksum+stop+
// margem). Estimativa conservadora; zona de silêncio de 10 módulos por lado.
const CODE128_MODULOS_FIXOS = 35;
const CODE128_MODULOS_POR_CHAR = 11;
const CODE128_QZ_MODULOS = 10;

/**
 * Calcula a maior geometria de código de barras que cabe em `larguraDisponivelDots`
 * SEM reescala raster: escolhe o maior `moduloDots` inteiro tal que
 * `(símbolo + zona de silêncio) * moduloDots <= larguraDisponivelDots`, com
 * piso de 2 dots/módulo (mínimo confiável para leitura em ~203 dpi).
 *
 * A altura das barras ocupa quase toda a área vertical disponível (menos o
 * espaço do número), com teto de 22 mm e piso de 6 mm. A fonte do número
 * respeita o limite do JsBarcode para EAN (`width * 10`).
 */
export function calcularGeometriaCodigoBarras(opts: {
  larguraDisponivelDots: number;
  alturaDisponivelDots: number;
  dpi: number;
  formato: FormatoCodigoBarras;
  /** Nº de caracteres do dado — usado só para estimar a largura do CODE128. */
  qtdCaracteres: number;
  /** `textMargin` que será passado ao JsBarcode (default ~0.4 mm). */
  textMarginDots?: number;
}): GeometriaCodigoBarras {
  const { larguraDisponivelDots, alturaDisponivelDots, dpi, formato } = opts;
  const mm = (v: number) => (v / 25.4) * dpi;
  const textMarginDots = Math.max(1, Math.round(opts.textMarginDots ?? mm(0.4)));

  const ean = formato === "EAN13";
  const modulosSimbolo = ean
    ? EAN13_MODULOS_SIMBOLO
    : CODE128_MODULOS_FIXOS + Math.max(1, Math.round(opts.qtdCaracteres)) * CODE128_MODULOS_POR_CHAR;
  const qzEsqModulos = ean ? EAN13_QZ_ESQUERDA_MODULOS : CODE128_QZ_MODULOS;
  const qzDirModulos = ean ? EAN13_QZ_DIREITA_MODULOS : CODE128_QZ_MODULOS;
  const modulosTotais = modulosSimbolo + qzEsqModulos + qzDirModulos;

  const moduloDots = Math.max(
    2,
    Math.floor(Math.max(1, larguraDisponivelDots) / modulosTotais),
  );

  const margemEsquerdaDots = qzEsqModulos * moduloDots;
  const margemDireitaDots = qzDirModulos * moduloDots;
  const larguraTotalDots = modulosSimbolo * moduloDots + margemEsquerdaDots + margemDireitaDots;

  // JsBarcode limita a fonte do EAN a `width * 10` — respeitamos para não
  // "brigar" com a lib e acabar com o canvas maior que o previsto.
  const fonteNumeroDots = Math.min(
    moduloDots * 10,
    Math.max(mm(2), Math.min(mm(3), alturaDisponivelDots * 0.18)),
  );
  // Espaço vertical fora das barras (número + folga do guard bar do EAN).
  // Medido do JsBarcode: overhead_v ~= fontSize*1.5 + textMargin*2 + ~8 (EAN).
  // Usamos 1.7 + folga para GARANTIR que o canvas gerado caiba na área sem
  // reescala — downscale de barras prontas gera módulos irregulares.
  const espacoNumeroDots = ean
    ? fonteNumeroDots * 1.7 + textMarginDots * 2 + mm(0.9)
    : fonteNumeroDots * 1.3 + textMarginDots + mm(0.6);

  const alturaBarrasDots = Math.max(
    mm(6),
    Math.min(Math.max(1, alturaDisponivelDots) - espacoNumeroDots, mm(22)),
  );

  return {
    moduloDots,
    margemEsquerdaDots,
    margemDireitaDots,
    alturaBarrasDots,
    fonteNumeroDots,
    larguraTotalDots,
    alturaTotalDots: alturaBarrasDots + espacoNumeroDots,
  };
}

/**
 * Gera o código com o JsBarcode NA geometria calculada e o desenha centralizado
 * na área alvo. Desenha 1:1; só reduz (nunca amplia) se a medição real da fonte
 * fizer o canvas passar do alvo. Retorna as dimensões efetivamente desenhadas.
 */
export function desenharCodigoBarras(opts: {
  ctx: CanvasRenderingContext2D;
  codigo: string;
  formato: FormatoCodigoBarras;
  geometria: GeometriaCodigoBarras;
  /** Retângulo alvo (dots) onde o código é centralizado. */
  areaXDots: number;
  areaYDots: number;
  areaLarguraDots: number;
  areaAlturaDots: number;
  textMarginDots?: number;
}): { larguraDesenhadaDots: number; alturaDesenhadaDots: number } {
  const { ctx, codigo, formato, geometria: g } = opts;
  const vazio = { larguraDesenhadaDots: 0, alturaDesenhadaDots: 0 };

  const bc = document.createElement("canvas");
  try {
    JsBarcode(bc, codigo, {
      format: formato,
      width: g.moduloDots,
      height: Math.max(1, Math.round(g.alturaBarrasDots)),
      displayValue: true,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: Math.round(g.margemEsquerdaDots),
      marginRight: Math.round(g.margemDireitaDots),
      fontSize: Math.max(8, Math.round(g.fonteNumeroDots)),
      textMargin: Math.max(1, Math.round(opts.textMarginDots ?? 2)),
      background: "#ffffff",
      lineColor: "#000000",
    });
  } catch {
    return vazio;
  }
  if (bc.width === 0 || bc.height === 0) return vazio;

  const escala = Math.min(
    1,
    opts.areaLarguraDots / bc.width,
    opts.areaAlturaDots / bc.height,
  );
  const dw = Math.max(1, Math.round(bc.width * escala));
  const dh = Math.max(1, Math.round(bc.height * escala));
  const dx = Math.round(opts.areaXDots + (opts.areaLarguraDots - dw) / 2);
  const dy = Math.round(opts.areaYDots + (opts.areaAlturaDots - dh) / 2);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bc, dx, dy, dw, dh);
  return { larguraDesenhadaDots: dw, alturaDesenhadaDots: dh };
}
