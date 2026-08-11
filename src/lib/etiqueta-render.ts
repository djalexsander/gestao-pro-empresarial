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
  let fontPx = match ? Number(match[1]) : 16;
  const baseFamily = fontCss.replace(/\d+(?:\.\d+)?px/, "FX");

  for (let tentativa = 0; tentativa < 6; tentativa++) {
    ctx.font = baseFamily.replace("FX", `${Math.round(fontPx)}px`);
    const palavras = texto.split(/\s+/).filter(Boolean);
    const linhas: string[] = [];
    let atual = "";
    for (const p of palavras) {
      const probe = atual ? `${atual} ${p}` : p;
      if (ctx.measureText(probe).width <= maxWidth) {
        atual = probe;
      } else {
        if (atual) linhas.push(atual);
        atual = p;
        if (linhas.length >= maxLinhas) break;
      }
    }
    if (atual && linhas.length < maxLinhas) linhas.push(atual);

    const couberam =
      linhas.length > 0 &&
      linhas.length <= maxLinhas &&
      linhas.every((l) => ctx.measureText(l).width <= maxWidth);
    if (couberam) return { lines: linhas, fontPx: Math.round(fontPx) };
    fontPx *= 0.9;
  }

  ctx.font = baseFamily.replace("FX", `${Math.round(fontPx)}px`);
  let s = texto;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) {
    s = s.slice(0, -1);
  }
  return { lines: [s + "…"], fontPx: Math.round(fontPx) };
}
