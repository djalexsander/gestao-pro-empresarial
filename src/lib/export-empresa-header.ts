/**
 * Cabeçalho de identificação da empresa em exportações (PDF, PNG e CSV).
 *
 * Centraliza a leitura de `configuracoes_empresa` e a renderização do
 * cabeçalho nas três variações para que TODAS as exportações do sistema
 * tenham o mesmo padrão visual / textual sem precisar passar dados pelo
 * caller.
 */

import type jsPDF from "jspdf";
import { supabase } from "@/integrations/supabase/client";

export interface EmpresaHeader {
  nome: string;
  cnpj: string | null;
  logoDataUrl: string | null;
  logoMime: "image/png" | "image/jpeg" | null;
  logoWidth: number | null;
  logoHeight: number | null;
}

let cache: { user: string | null; data: EmpresaHeader | null; ts: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

function pickName(razao: string | null, fantasia: string | null): string {
  return (fantasia || razao || "Minha empresa").trim();
}

async function imageUrlToDataUrl(
  url: string,
): Promise<{ dataUrl: string; mime: "image/png" | "image/jpeg"; width: number; height: number } | null> {
  try {
    const resp = await fetch(url, { cache: "force-cache" });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const mime = blob.type === "image/jpeg" ? "image/jpeg" : "image/png";

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("read"));
      reader.readAsDataURL(blob);
    });

    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 0, h: 0 });
      img.src = dataUrl;
    });

    return { dataUrl, mime, width: dims.w, height: dims.h };
  } catch {
    return null;
  }
}

/**
 * Carrega cabeçalho da empresa do usuário logado (com cache).
 * Retorna null se não houver sessão; os exports devem seguir sem cabeçalho.
 */
export async function fetchEmpresaHeader(): Promise<EmpresaHeader | null> {
  const { data: u } = await supabase.auth.getUser();
  const userId = u.user?.id ?? null;
  if (!userId) return null;

  if (
    cache &&
    cache.user === userId &&
    Date.now() - cache.ts < CACHE_TTL_MS
  ) {
    return cache.data;
  }

  const { data, error } = await supabase
    .from("configuracoes_empresa")
    .select("razao_social, nome_fantasia, cnpj, logo_url")
    .maybeSingle();

  if (error || !data) {
    cache = { user: userId, data: null, ts: Date.now() };
    return null;
  }

  let logoDataUrl: string | null = null;
  let logoMime: "image/png" | "image/jpeg" | null = null;
  let logoWidth: number | null = null;
  let logoHeight: number | null = null;
  if (data.logo_url) {
    const fetched = await imageUrlToDataUrl(data.logo_url);
    if (fetched && fetched.width > 0 && fetched.height > 0) {
      logoDataUrl = fetched.dataUrl;
      logoMime = fetched.mime;
      logoWidth = fetched.width;
      logoHeight = fetched.height;
    }
  }

  const header: EmpresaHeader = {
    nome: pickName(data.razao_social, data.nome_fantasia),
    cnpj: data.cnpj ? data.cnpj.trim() || null : null,
    logoDataUrl,
    logoMime,
    logoWidth,
    logoHeight,
  };

  cache = { user: userId, data: header, ts: Date.now() };
  return header;
}

// ---------- PDF ----------

export interface PdfHeaderOptions {
  empresa: EmpresaHeader | null;
  titulo: string;
  periodo?: string | null;
  exportadoEm: Date;
}

/**
 * Desenha o cabeçalho institucional no PDF e retorna o Y inicial para o
 * conteúdo seguinte (em mm). Layout:
 *   [LOGO]   NOME DA EMPRESA            (em destaque)
 *            CNPJ: ...
 *            ────────────────────
 *            TÍTULO DO RELATÓRIO
 *            Período: ...
 *            Exportado em: ...
 */
export function desenharCabecalhoPDF(doc: jsPDF, opts: PdfHeaderOptions): number {
  const margemX = 14;
  const topo = 12;
  const larguraPagina = doc.internal.pageSize.getWidth();
  const { empresa, titulo, periodo, exportadoEm } = opts;

  let logoBoxW = 0;
  const logoBoxH = 18;

  if (empresa?.logoDataUrl && empresa.logoWidth && empresa.logoHeight) {
    const ratio = empresa.logoWidth / empresa.logoHeight;
    logoBoxW = Math.min(28, logoBoxH * ratio);
    try {
      doc.addImage(
        empresa.logoDataUrl,
        empresa.logoMime === "image/jpeg" ? "JPEG" : "PNG",
        margemX,
        topo,
        logoBoxW,
        logoBoxH,
        undefined,
        "FAST",
      );
    } catch {
      logoBoxW = 0;
    }
  }

  const textoX = margemX + (logoBoxW > 0 ? logoBoxW + 6 : 0);
  let cursorY = topo + 5;

  // Nome em destaque
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(20);
  doc.text(empresa?.nome ?? "Minha empresa", textoX, cursorY);
  cursorY += 5;

  if (empresa?.cnpj) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(80);
    doc.text(`CNPJ: ${empresa.cnpj}`, textoX, cursorY);
    cursorY += 4;
  }

  // Linha divisória
  const linhaY = Math.max(cursorY + 1, topo + logoBoxH + 1);
  doc.setDrawColor(200);
  doc.setLineWidth(0.3);
  doc.line(margemX, linhaY, larguraPagina - margemX, linhaY);

  // Bloco do título / período / exportado em
  let infoY = linhaY + 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(20);
  doc.text(titulo, margemX, infoY);
  infoY += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90);
  if (periodo) {
    doc.text(`Período: ${periodo}`, margemX, infoY);
    infoY += 4;
  }
  doc.text(
    `Exportado em: ${exportadoEm.toLocaleString("pt-BR")}`,
    margemX,
    infoY,
  );
  infoY += 4;

  doc.setTextColor(0);
  return infoY + 4;
}

/** Adiciona rodapé com numeração "Página X de Y" em todas as páginas. */
export function adicionarRodapePaginacao(doc: jsPDF) {
  const total = doc.getNumberOfPages();
  if (total <= 1) return;
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Página ${i} de ${total}`, w - 14, h - 8, { align: "right" });
  }
  doc.setTextColor(0);
}

// ---------- CSV ----------

export interface CsvHeaderOptions {
  empresa: EmpresaHeader | null;
  relatorio: string;
  periodo?: string | null;
  exportadoEm: Date;
}

function escapeCsvHeaderValue(s: string): string {
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Monta as linhas iniciais do CSV (já com CRLF) e termina com uma linha em
 * branco para separar do cabeçalho da tabela.
 */
export function montarCabecalhoCSV(opts: CsvHeaderOptions): string {
  const { empresa, relatorio, periodo, exportadoEm } = opts;
  const linhas: string[] = [];
  linhas.push(`Empresa: ${escapeCsvHeaderValue(empresa?.nome ?? "Minha empresa")}`);
  if (empresa?.cnpj) linhas.push(`CNPJ: ${escapeCsvHeaderValue(empresa.cnpj)}`);
  linhas.push(`Relatório: ${escapeCsvHeaderValue(relatorio)}`);
  if (periodo) linhas.push(`Período: ${escapeCsvHeaderValue(periodo)}`);
  linhas.push(
    `Exportado em: ${escapeCsvHeaderValue(exportadoEm.toLocaleString("pt-BR"))}`,
  );
  linhas.push(""); // separador
  return linhas.join("\r\n") + "\r\n";
}

// ---------- PNG (HTML injetado no clone) ----------

export interface PngHeaderOptions {
  empresa: EmpresaHeader | null;
  titulo: string;
  periodo?: string | null;
  exportadoEm: Date;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Cria o nó de cabeçalho HTML pronto para ser anexado no topo do wrapper
 * de exportação PNG. Sempre claro / fundo branco / texto escuro.
 */
export function criarCabecalhoPNGElement(opts: PngHeaderOptions): HTMLElement {
  const { empresa, titulo, periodo, exportadoEm } = opts;
  const wrap = document.createElement("div");
  wrap.style.cssText = [
    "display:flex",
    "align-items:center",
    "gap:16px",
    "padding:0 0 16px 0",
    "margin:0 0 16px 0",
    "border-bottom:1px solid #334155",
    "font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif",
    "color:#ffffff",
    "background:#0f172a",
  ].join(";");

  if (empresa?.logoDataUrl) {
    const img = document.createElement("img");
    img.src = empresa.logoDataUrl;
    img.alt = "Logo";
    img.style.cssText =
      "height:56px;width:auto;object-fit:contain;flex:0 0 auto;background:#ffffff;border-radius:6px;padding:4px";
    wrap.appendChild(img);
  }

  const meta = document.createElement("div");
  meta.style.cssText = "display:flex;flex-direction:column;gap:2px;flex:1 1 auto;min-width:0";

  const linhas: string[] = [];
  linhas.push(
    `<div style="font-size:18px;font-weight:700;color:#ffffff">${escapeHtml(empresa?.nome ?? "Minha empresa")}</div>`,
  );
  if (empresa?.cnpj) {
    linhas.push(
      `<div style="font-size:12px;color:#cbd5e1">CNPJ: ${escapeHtml(empresa.cnpj)}</div>`,
    );
  }
  linhas.push(
    `<div style="font-size:14px;font-weight:600;color:#ffffff;margin-top:4px">${escapeHtml(titulo)}</div>`,
  );
  if (periodo) {
    linhas.push(
      `<div style="font-size:11px;color:#cbd5e1">Período: ${escapeHtml(periodo)}</div>`,
    );
  }
  linhas.push(
    `<div style="font-size:11px;color:#cbd5e1">Exportado em: ${escapeHtml(exportadoEm.toLocaleString("pt-BR"))}</div>`,
  );

  meta.innerHTML = linhas.join("");
  wrap.appendChild(meta);
  return wrap;
}
