/**
 * Renderer de PNG via Canvas 2D nativo — sem html2canvas / html-to-image.
 *
 * Por quê: capturar o DOM falha com tema escuro, blur, oklch, gradientes,
 * backdrop-filter etc. Aqui desenhamos o relatório diretamente, com layout
 * controlado, fundo dark sólido com gradient suave, cabeçalho institucional
 * (logo + nome + CNPJ), cards de resumo e tabela com zebra.
 *
 * Inspirado no padrão usado no app "Minha Agenda".
 */

import type { EmpresaHeader } from "@/lib/export-empresa-header";

// ---------- Tema ----------
const THEME = {
  bgTop: "#0b1220",       // gradient topo
  bgBottom: "#0f172a",    // gradient base
  surface: "#111827",     // cards / superfícies
  surfaceAlt: "#1f2937",  // cabeçalho de tabela / linha alternada
  border: "#334155",
  fg: "#ffffff",
  muted: "#cbd5e1",
  mutedSoft: "#94a3b8",
  accent: "#60a5fa",
  success: "#4ade80",
  danger: "#f87171",
  warning: "#facc15",
  info: "#60a5fa",
} as const;

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

// ---------- Tipos públicos ----------

export type CanvasCellAlign = "left" | "right" | "center";

export interface CanvasResumoCard {
  label: string;
  valor: string;
  tone?: "success" | "danger" | "info" | "muted" | "warning" | "default";
}

export interface CanvasColumn {
  header: string;
  align?: CanvasCellAlign;
  /** Largura relativa (peso). Se omitido, todas dividem por igual. */
  weight?: number;
  /** Tom aplicado aos valores da coluna inteira. */
  tone?: CanvasResumoCard["tone"];
}

export interface CanvasTablePayload {
  columns: CanvasColumn[];
  rows: string[][];
  emptyMessage?: string;
}

export interface CanvasReportPayload {
  empresa: EmpresaHeader | null;
  titulo: string;
  subtitulo?: string | null;
  periodo?: string | null;
  exportadoEm: Date;
  origem?: string | null;
  resumo?: CanvasResumoCard[];
  alerta?: { titulo: string; descricao?: string } | null;
  tabela?: CanvasTablePayload | null;
  /** Linhas livres exibidas após a tabela (ex.: rodapé textual). */
  rodape?: string[];
}

// ---------- Utilidades ----------

function hex(color: string, alpha?: number): string {
  if (alpha === undefined) return color;
  const a = Math.max(0, Math.min(1, alpha));
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function toneColor(tone?: CanvasResumoCard["tone"]): string {
  switch (tone) {
    case "success": return THEME.success;
    case "danger":  return THEME.danger;
    case "info":    return THEME.info;
    case "warning": return THEME.warning;
    case "muted":   return THEME.muted;
    default:        return THEME.fg;
  }
}

function setFont(
  ctx: CanvasRenderingContext2D,
  size: number,
  weight: "normal" | "bold" | "600" = "normal",
) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textBaseline = "top";
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 2,
): string[] {
  if (!text) return [""];
  const words = String(text).split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const test = current ? `${current} ${w}` : w;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = w;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (current) lines.push(current);
  if (lines.length === 0) lines.push("");
  // Ajusta a última linha com elipse se necessário
  if (lines.length === maxLines) {
    let last = lines[maxLines - 1];
    while (ctx.measureText(`${last}…`).width > maxWidth && last.length > 0) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = last + (text.length > last.length ? "…" : "");
  }
  return lines;
}

function truncateLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 0 && ctx.measureText(`${s}…`).width > maxWidth) {
    s = s.slice(0, -1);
  }
  return s + "…";
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

async function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// ---------- Layout config ----------

const PADDING = 32;
const WIDTH = 1280;        // Largura fixa do PNG (boa qualidade A4-like)
const HEADER_H = 110;      // Altura do bloco de cabeçalho institucional
const TITLE_BLOCK_H = 70;
const RESUMO_CARD_H = 78;
const RESUMO_GAP = 12;
const TABLE_HEADER_H = 38;
const TABLE_ROW_H = 32;
const TABLE_ROW_H_MULTI = 48; // quando há quebra de linha em alguma célula
const SECTION_GAP = 22;
const ALERT_BLOCK_H = 64;

// ---------- Render principal ----------

export async function renderReportCanvas(
  payload: CanvasReportPayload,
): Promise<HTMLCanvasElement> {
  // 1) Pré-carrega logo (se houver) para já saber dimensões
  const logo = payload.empresa?.logoDataUrl
    ? await loadImage(payload.empresa.logoDataUrl)
    : null;

  // 2) Calcula colunas / pesos da tabela (precisa de ctx para medir multilinha)
  // Cria canvas temporário para medições
  const measureCanvas = document.createElement("canvas");
  const mctx = measureCanvas.getContext("2d");
  if (!mctx) throw new Error("Canvas 2D indisponível");

  const innerWidth = WIDTH - PADDING * 2;

  // Cálculo de larguras de coluna
  let colWidths: number[] = [];
  let rowHeights: number[] = [];
  let tableContentHeight = 0;
  if (payload.tabela) {
    const cols = payload.tabela.columns;
    const totalWeight = cols.reduce((s, c) => s + (c.weight ?? 1), 0) || 1;
    colWidths = cols.map((c) => Math.floor((innerWidth * (c.weight ?? 1)) / totalWeight));
    // Ajuste de arredondamento
    const diff = innerWidth - colWidths.reduce((a, b) => a + b, 0);
    if (colWidths.length > 0) colWidths[colWidths.length - 1] += diff;

    setFont(mctx, 13, "normal");
    rowHeights = payload.tabela.rows.map((row) => {
      // Altura por linha: se alguma célula precisar quebrar, usa altura maior
      let needsMulti = false;
      row.forEach((cell, i) => {
        const lines = wrapText(mctx, String(cell ?? ""), colWidths[i] - 20, 2);
        if (lines.length > 1) needsMulti = true;
      });
      return needsMulti ? TABLE_ROW_H_MULTI : TABLE_ROW_H;
    });
    if (payload.tabela.rows.length === 0) {
      rowHeights = [TABLE_ROW_H];
    }
    tableContentHeight = rowHeights.reduce((a, b) => a + b, 0);
  }

  // 3) Calcula altura total
  let totalHeight = PADDING + HEADER_H + SECTION_GAP + TITLE_BLOCK_H;
  if (payload.resumo && payload.resumo.length) {
    const cardsPorLinha = payload.resumo.length <= 3 ? payload.resumo.length : 3;
    const linhas = Math.ceil(payload.resumo.length / cardsPorLinha);
    totalHeight += linhas * RESUMO_CARD_H + (linhas - 1) * RESUMO_GAP + SECTION_GAP;
  }
  if (payload.alerta) {
    totalHeight += ALERT_BLOCK_H + SECTION_GAP;
  }
  if (payload.tabela) {
    totalHeight += TABLE_HEADER_H + tableContentHeight + SECTION_GAP;
  }
  if (payload.rodape && payload.rodape.length) {
    totalHeight += payload.rodape.length * 18 + 12;
  }
  totalHeight += PADDING;

  // 4) Cria canvas final com pixel ratio para nitidez
  // Limites práticos por engine: Chrome ~32767, Safari/WebKit ~16384, alguns
  // mobiles ~4096. Calculamos o maior `ratio` (até 2x) que ainda mantém o
  // canvas dentro de um limite seguro — caso contrário a imagem é truncada
  // ou `toDataURL` falha silenciosamente. Garante que TODAS as linhas saiam.
  const MAX_DIM = 16000;
  let ratio = 2;
  while (ratio > 1 && (totalHeight * ratio > MAX_DIM || WIDTH * ratio > MAX_DIM)) {
    ratio -= 0.25;
  }
  if (totalHeight * ratio > MAX_DIM) ratio = MAX_DIM / totalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(WIDTH * ratio);
  canvas.height = Math.floor(totalHeight * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D indisponível");
  ctx.scale(ratio, ratio);

  // ---------- Fundo (gradient dark) ----------
  const grad = ctx.createLinearGradient(0, 0, 0, totalHeight);
  grad.addColorStop(0, THEME.bgTop);
  grad.addColorStop(1, THEME.bgBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WIDTH, totalHeight);

  // Marca d'água sutil de cantos
  ctx.fillStyle = hex(THEME.accent, 0.04);
  ctx.beginPath();
  ctx.arc(WIDTH - 80, 80, 220, 0, Math.PI * 2);
  ctx.fill();

  let cursorY = PADDING;

  // ---------- Cabeçalho institucional ----------
  cursorY = drawCompanyHeader(ctx, payload, logo, cursorY);
  cursorY += SECTION_GAP;

  // ---------- Bloco Título do relatório ----------
  cursorY = drawTitleBlock(ctx, payload, cursorY);
  cursorY += SECTION_GAP;

  // ---------- Cards de resumo ----------
  if (payload.resumo && payload.resumo.length) {
    cursorY = drawResumo(ctx, payload.resumo, cursorY);
    cursorY += SECTION_GAP;
  }

  // ---------- Alerta ----------
  if (payload.alerta) {
    cursorY = drawAlerta(ctx, payload.alerta, cursorY);
    cursorY += SECTION_GAP;
  }

  // ---------- Tabela ----------
  if (payload.tabela) {
    cursorY = drawTabela(ctx, payload.tabela, colWidths, rowHeights, cursorY);
    cursorY += SECTION_GAP;
  }

  // ---------- Rodapé ----------
  if (payload.rodape && payload.rodape.length) {
    setFont(ctx, 11, "normal");
    ctx.fillStyle = THEME.mutedSoft;
    payload.rodape.forEach((line) => {
      ctx.fillText(line, PADDING, cursorY);
      cursorY += 16;
    });
  }

  return canvas;
}

// ---------- Seções ----------

function drawCompanyHeader(
  ctx: CanvasRenderingContext2D,
  payload: CanvasReportPayload,
  logo: HTMLImageElement | null,
  startY: number,
): number {
  const x = PADDING;
  const y = startY;
  const w = WIDTH - PADDING * 2;
  const h = HEADER_H;

  // Card de fundo
  ctx.fillStyle = THEME.surface;
  roundedRect(ctx, x, y, w, h, 12);
  ctx.fill();
  ctx.strokeStyle = THEME.border;
  ctx.lineWidth = 1;
  ctx.stroke();

  let textX = x + 20;
  if (logo) {
    const maxLogoH = h - 32;
    const ratio = logo.naturalWidth / logo.naturalHeight;
    const logoH = maxLogoH;
    const logoW = Math.min(140, logoH * ratio);
    // Fundo branco para a logo
    ctx.fillStyle = "#ffffff";
    roundedRect(ctx, x + 20, y + 16, logoW + 16, logoH + 16, 8);
    ctx.fill();
    ctx.drawImage(logo, x + 28, y + 24, logoW, logoH);
    textX = x + 20 + logoW + 16 + 20;
  }

  // Nome da empresa
  setFont(ctx, 22, "bold");
  ctx.fillStyle = THEME.fg;
  const nome = truncateLine(ctx, payload.empresa?.nome ?? "Minha empresa", w - (textX - x) - 220);
  ctx.fillText(nome, textX, y + 24);

  // CNPJ
  if (payload.empresa?.cnpj) {
    setFont(ctx, 13, "normal");
    ctx.fillStyle = THEME.muted;
    ctx.fillText(`CNPJ: ${payload.empresa.cnpj}`, textX, y + 56);
  }

  // Data exportação à direita
  setFont(ctx, 11, "normal");
  ctx.fillStyle = THEME.mutedSoft;
  ctx.textAlign = "right";
  ctx.fillText(
    `Exportado em ${payload.exportadoEm.toLocaleString("pt-BR")}`,
    x + w - 20,
    y + h - 28,
  );
  ctx.textAlign = "left";

  return y + h;
}

function drawTitleBlock(
  ctx: CanvasRenderingContext2D,
  payload: CanvasReportPayload,
  startY: number,
): number {
  const x = PADDING;
  const w = WIDTH - PADDING * 2;

  // Faixa de destaque
  ctx.fillStyle = hex(THEME.accent, 0.12);
  roundedRect(ctx, x, startY, 4, TITLE_BLOCK_H - 10, 2);
  ctx.fill();

  setFont(ctx, 24, "bold");
  ctx.fillStyle = THEME.fg;
  ctx.fillText(truncateLine(ctx, payload.titulo, w - 20), x + 16, startY + 2);

  let metaY = startY + 36;

  if (payload.subtitulo) {
    setFont(ctx, 13, "normal");
    ctx.fillStyle = THEME.muted;
    ctx.fillText(truncateLine(ctx, payload.subtitulo, w - 20), x + 16, metaY);
    metaY += 18;
  }

  const metas: string[] = [];
  if (payload.periodo) metas.push(`Período: ${payload.periodo}`);
  if (payload.origem) metas.push(`Origem: ${payload.origem}`);
  if (metas.length) {
    setFont(ctx, 12, "normal");
    ctx.fillStyle = THEME.mutedSoft;
    ctx.fillText(metas.join("   ·   "), x + 16, metaY);
  }

  return startY + TITLE_BLOCK_H;
}

function drawResumo(
  ctx: CanvasRenderingContext2D,
  cards: CanvasResumoCard[],
  startY: number,
): number {
  const innerW = WIDTH - PADDING * 2;
  const perRow = cards.length <= 3 ? cards.length : 3;
  const cardW = (innerW - RESUMO_GAP * (perRow - 1)) / perRow;

  let y = startY;
  let row: CanvasResumoCard[] = [];
  let drawn = 0;

  for (let i = 0; i < cards.length; i++) {
    row.push(cards[i]);
    if (row.length === perRow || i === cards.length - 1) {
      row.forEach((c, idx) => {
        const x = PADDING + idx * (cardW + RESUMO_GAP);
        // Card
        ctx.fillStyle = THEME.surface;
        roundedRect(ctx, x, y, cardW, RESUMO_CARD_H, 10);
        ctx.fill();
        ctx.strokeStyle = THEME.border;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Label
        setFont(ctx, 11, "600");
        ctx.fillStyle = THEME.mutedSoft;
        ctx.fillText(
          truncateLine(ctx, c.label.toUpperCase(), cardW - 28),
          x + 14,
          y + 14,
        );

        // Valor
        setFont(ctx, 22, "bold");
        ctx.fillStyle = toneColor(c.tone);
        ctx.fillText(truncateLine(ctx, c.valor, cardW - 28), x + 14, y + 36);
      });
      drawn += row.length;
      row = [];
      if (drawn < cards.length) y += RESUMO_CARD_H + RESUMO_GAP;
    }
  }

  return y + RESUMO_CARD_H;
}

function drawAlerta(
  ctx: CanvasRenderingContext2D,
  alerta: { titulo: string; descricao?: string },
  startY: number,
): number {
  const x = PADDING;
  const w = WIDTH - PADDING * 2;
  ctx.fillStyle = hex(THEME.warning, 0.12);
  roundedRect(ctx, x, startY, w, ALERT_BLOCK_H, 8);
  ctx.fill();
  ctx.strokeStyle = hex(THEME.warning, 0.5);
  ctx.lineWidth = 1;
  ctx.stroke();

  setFont(ctx, 14, "bold");
  ctx.fillStyle = THEME.warning;
  ctx.fillText(`⚠ ${truncateLine(ctx, alerta.titulo, w - 32)}`, x + 14, startY + 12);

  if (alerta.descricao) {
    setFont(ctx, 12, "normal");
    ctx.fillStyle = THEME.muted;
    ctx.fillText(truncateLine(ctx, alerta.descricao, w - 32), x + 14, startY + 36);
  }

  return startY + ALERT_BLOCK_H;
}

function drawTabela(
  ctx: CanvasRenderingContext2D,
  tabela: CanvasTablePayload,
  colWidths: number[],
  rowHeights: number[],
  startY: number,
): number {
  const x = PADDING;
  const w = WIDTH - PADDING * 2;
  const totalContent = rowHeights.reduce((a, b) => a + b, 0);
  const totalH = TABLE_HEADER_H + totalContent;

  // Container
  ctx.fillStyle = THEME.surface;
  roundedRect(ctx, x, startY, w, totalH, 10);
  ctx.fill();
  ctx.strokeStyle = THEME.border;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Header
  ctx.fillStyle = THEME.surfaceAlt;
  // Cabeçalho com cantos superiores arredondados (clip via path)
  ctx.save();
  roundedRect(ctx, x, startY, w, totalH, 10);
  ctx.clip();
  ctx.fillRect(x, startY, w, TABLE_HEADER_H);
  ctx.restore();

  setFont(ctx, 12, "bold");
  ctx.fillStyle = THEME.muted;
  let cx = x;
  tabela.columns.forEach((col, i) => {
    const cw = colWidths[i];
    drawCell(ctx, col.header.toUpperCase(), cx, startY, cw, TABLE_HEADER_H, col.align ?? "left", THEME.muted, "bold", 12);
    cx += cw;
  });

  // Linha divisória header
  ctx.strokeStyle = THEME.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, startY + TABLE_HEADER_H);
  ctx.lineTo(x + w, startY + TABLE_HEADER_H);
  ctx.stroke();

  // Linhas
  if (tabela.rows.length === 0) {
    setFont(ctx, 13, "normal");
    ctx.fillStyle = THEME.mutedSoft;
    ctx.textAlign = "center";
    ctx.fillText(
      tabela.emptyMessage ?? "Sem dados para exibir.",
      x + w / 2,
      startY + TABLE_HEADER_H + 16,
    );
    ctx.textAlign = "left";
    return startY + totalH;
  }

  let ry = startY + TABLE_HEADER_H;
  tabela.rows.forEach((row, idx) => {
    const rh = rowHeights[idx];
    if (idx % 2 === 1) {
      ctx.fillStyle = hex(THEME.surfaceAlt, 0.4);
      ctx.fillRect(x, ry, w, rh);
    }
    let cellX = x;
    row.forEach((value, i) => {
      const col = tabela.columns[i];
      const cw = colWidths[i];
      const color = toneColor(col.tone);
      drawCell(ctx, String(value ?? ""), cellX, ry, cw, rh, col.align ?? "left", color, "normal", 13);
      cellX += cw;
    });
    ry += rh;
  });

  return startY + totalH;
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  align: CanvasCellAlign,
  color: string,
  weight: "normal" | "bold" | "600",
  size: number,
) {
  const padX = 12;
  setFont(ctx, size, weight);
  ctx.fillStyle = color;
  const lines = wrapText(ctx, text, w - padX * 2, h >= TABLE_ROW_H_MULTI ? 2 : 1);
  const lineHeight = size + 4;
  const blockH = lines.length * lineHeight;
  const startTextY = y + (h - blockH) / 2;
  lines.forEach((line, i) => {
    const tw = ctx.measureText(line).width;
    let tx = x + padX;
    if (align === "right") tx = x + w - padX - tw;
    else if (align === "center") tx = x + (w - tw) / 2;
    ctx.fillText(line, tx, startTextY + i * lineHeight);
  });
}

// ---------- Download ----------

import { saveBytes } from "@/lib/desktop-save";

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function downloadCanvasAsPng(canvas: HTMLCanvasElement, filename: string) {
  // Preferimos toBlob — evita string base64 gigante (que estoura limites em
  // canvases altos e gera PNGs truncados / "print-only"). Fallback para
  // toDataURL apenas se toBlob não estiver disponível.
  if (typeof canvas.toBlob === "function") {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        // Fallback se o navegador retornar null (geralmente canvas grande demais)
        try {
          const dataUrl = canvas.toDataURL("image/png");
          await saveBytes(dataUrlToBytes(dataUrl), filename, "image/png");
        } catch {
          /* swallow */
        }
        return;
      }
      const buf = new Uint8Array(await blob.arrayBuffer());
      void saveBytes(buf, filename, "image/png");
    }, "image/png");
    return;
  }
  const dataUrl = canvas.toDataURL("image/png");
  void saveBytes(dataUrlToBytes(dataUrl), filename, "image/png");
}
