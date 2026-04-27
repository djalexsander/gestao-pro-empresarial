// Exportação de blocos financeiros em PDF, PNG ou CSV.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { toPng } from "html-to-image";
import { toCSV, downloadCSV, csvFilename, type CsvColumn } from "@/lib/export-csv";
import { applyPrintTheme, PRINT_THEME, waitForRenderReady } from "@/lib/export-png-theme";
import {
  fetchEmpresaHeader,
  desenharCabecalhoPDF,
  adicionarRodapePaginacao,
  montarCabecalhoCSV,
  criarCabecalhoPNGElement,
} from "@/lib/export-empresa-header";

function tsFilename(prefix: string, ext: string): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${prefix}_${y}-${m}-${day}.${ext}`;
}

export interface PdfTableSpec<T> {
  header: string[];
  rows: T[];
  formatRow: (row: T) => (string | number)[];
}

export interface ExportPdfOptions<T> {
  titulo: string;
  /** Subtítulo opcional (ex.: "Origem: vendas finalizadas"). Renderizado abaixo do título. */
  subtitulo?: string;
  /** Período legível (ex.: "01/04/2026 a 27/04/2026") — vai no cabeçalho da empresa. */
  periodo?: string | null;
  resumo?: { label: string; valor: string }[];
  tabela?: PdfTableSpec<T>;
  rodape?: string;
}

export async function exportarBlocoPDF<T>(opts: ExportPdfOptions<T>) {
  const empresa = await fetchEmpresaHeader();
  const exportadoEm = new Date();

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  // Cabeçalho institucional + título do relatório
  let cursorY = desenharCabecalhoPDF(doc, {
    empresa,
    titulo: opts.titulo,
    periodo: opts.periodo ?? null,
    exportadoEm,
  });

  if (opts.subtitulo) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(opts.subtitulo, 14, cursorY);
    doc.setTextColor(0);
    cursorY += 5;
  }

  if (opts.resumo && opts.resumo.length) {
    autoTable(doc, {
      startY: cursorY,
      head: [["Indicador", "Valor"]],
      body: opts.resumo.map((r) => [r.label, r.valor]),
      theme: "grid",
      headStyles: { fillColor: [40, 40, 40] },
      styles: { fontSize: 10 },
      margin: { left: 14, right: 14 },
    });
    // @ts-expect-error lastAutoTable injetado pelo autotable
    cursorY = doc.lastAutoTable.finalY + 8;
  }

  if (opts.tabela && opts.tabela.rows.length > 0) {
    autoTable(doc, {
      startY: cursorY,
      head: [opts.tabela.header],
      body: opts.tabela.rows.map(opts.tabela.formatRow),
      theme: "striped",
      headStyles: { fillColor: [30, 80, 160] },
      styles: { fontSize: 9 },
      margin: { left: 14, right: 14 },
    });
  }

  // Rodapé de geração + paginação (se mais de 1 página)
  const finalText = opts.rodape ?? `Gerado em ${exportadoEm.toLocaleString("pt-BR")}`;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(finalText, 14, doc.internal.pageSize.getHeight() - 8);
  doc.setTextColor(0);

  adicionarRodapePaginacao(doc);

  doc.save(tsFilename(slug(opts.titulo), "pdf"));
  return doc.internal.pageSize.getWidth();
}

export interface ExportPngOptions {
  titulo?: string;
  periodo?: string | null;
}

/**
 * Exporta o conteúdo do elemento como PNG, com cabeçalho da empresa no topo
 * (logo, nome, CNPJ, período, data/hora). Usa tema claro forçado no clone
 * para garantir legibilidade independente do tema do sistema.
 */
export async function exportarBlocoPNG(
  element: HTMLElement,
  prefix: string,
  opts: ExportPngOptions = {},
) {
  const empresa = await fetchEmpresaHeader();
  const exportadoEm = new Date();

  // Clone do conteúdo (mantém o DOM visível intacto)
  const clone = element.cloneNode(true) as HTMLElement;

  clone.querySelectorAll<HTMLElement>("[data-radix-scroll-area-viewport]").forEach((el) => {
    el.style.overflow = "visible";
    el.style.maxHeight = "none";
    el.style.height = "auto";
  });
  clone.querySelectorAll<HTMLElement>("*").forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.overflow === "auto" || cs.overflow === "scroll" || cs.overflowX === "auto" || cs.overflowY === "auto") {
      el.style.overflow = "visible";
    }
    if (el.style.maxHeight) el.style.maxHeight = "none";
  });
  clone.querySelectorAll<HTMLElement>("[data-radix-scroll-area-scrollbar]").forEach((el) => {
    el.style.display = "none";
  });

  const fullWidth = Math.max(element.scrollWidth, element.offsetWidth, 1024);
  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.top = "0";
  wrapper.style.left = "-99999px";
  wrapper.style.width = `${fullWidth}px`;
  wrapper.style.background = PRINT_THEME.bg;
  wrapper.style.padding = "24px";
  wrapper.style.fontFamily = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

  // Cabeçalho institucional ANTES do conteúdo
  const header = criarCabecalhoPNGElement({
    empresa,
    titulo: opts.titulo ?? prefix,
    periodo: opts.periodo ?? null,
    exportadoEm,
  });
  wrapper.appendChild(header);

  clone.style.width = "100%";
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);

  applyPrintTheme(wrapper);
  await waitForRenderReady();

  try {
    const dataUrl = await toPng(wrapper, {
      pixelRatio: 2,
      backgroundColor: PRINT_THEME.bg,
      cacheBust: true,
      width: wrapper.scrollWidth,
      height: wrapper.scrollHeight,
      style: { transform: "none" },
    });
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = tsFilename(slug(prefix), "png");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    document.body.removeChild(wrapper);
  }
}

export interface ExportCsvOptions {
  /** Nome do relatório para constar no cabeçalho (ex.: "Custo dos produtos vendidos"). */
  relatorio?: string;
  periodo?: string | null;
}

/**
 * Exporta as linhas como CSV pt-BR (BOM UTF-8, separador ";"), com cabeçalho
 * institucional nas primeiras linhas (Empresa, CNPJ, Relatório, Período,
 * Exportado em + linha em branco) antes do cabeçalho da tabela.
 */
export async function exportarBlocoCSV<T>(
  prefix: string,
  rows: T[],
  cols: CsvColumn<T>[],
  opts: ExportCsvOptions = {},
) {
  const empresa = await fetchEmpresaHeader();
  const exportadoEm = new Date();

  const cabecalho = montarCabecalhoCSV({
    empresa,
    relatorio: opts.relatorio ?? prefix,
    periodo: opts.periodo ?? null,
    exportadoEm,
  });
  const tabela = toCSV(rows, cols);
  downloadCSV(csvFilename(slug(prefix)), cabecalho + tabela);
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}
