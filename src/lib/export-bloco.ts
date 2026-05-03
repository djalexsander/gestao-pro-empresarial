// Exportação de blocos financeiros em PDF, PNG (Canvas nativo) ou CSV.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { toCSV, downloadCSV, csvFilename, type CsvColumn } from "@/lib/export-csv";
import {
  fetchEmpresaHeader,
  desenharCabecalhoPDF,
  adicionarRodapePaginacao,
  montarCabecalhoCSV,
} from "@/lib/export-empresa-header";
import {
  renderReportCanvas,
  downloadCanvasAsPng,
  type CanvasResumoCard,
  type CanvasColumn,
} from "@/lib/export-png-canvas";
import { saveBytes } from "@/lib/desktop-save";

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

  void saveBytes(
    new Uint8Array(doc.output("arraybuffer")),
    tsFilename(slug(opts.titulo), "pdf"),
    "application/pdf",
  );
  return doc.internal.pageSize.getWidth();
}

export interface ExportPngColumn extends CanvasColumn {}

export interface ExportPngOptions {
  titulo: string;
  subtitulo?: string | null;
  origem?: string | null;
  periodo?: string | null;
  resumo?: CanvasResumoCard[];
  alerta?: { titulo: string; descricao?: string } | null;
  tabela?: {
    columns: ExportPngColumn[];
    rows: string[][];
    emptyMessage?: string;
  } | null;
  rodape?: string[];
}

/**
 * Exporta o bloco como PNG desenhando diretamente em Canvas 2D nativo.
 *
 * NÃO captura o DOM (sem html2canvas / html-to-image): tema dark com gradient,
 * cabeçalho institucional (logo + nome + CNPJ + período + data), cards de
 * resumo e tabela com zebra são desenhados manualmente. Layout consistente
 * independente do tema do sistema, blur, oklch ou backdrop-filter.
 */
export async function exportarBlocoPNG(prefix: string, opts: ExportPngOptions) {
  const empresa = await fetchEmpresaHeader();
  const exportadoEm = new Date();
  const canvas = await renderReportCanvas({
    empresa,
    titulo: opts.titulo,
    subtitulo: opts.subtitulo ?? null,
    origem: opts.origem ?? null,
    periodo: opts.periodo ?? null,
    exportadoEm,
    resumo: opts.resumo,
    alerta: opts.alerta ?? null,
    tabela: opts.tabela ?? null,
    rodape: opts.rodape,
  });
  downloadCanvasAsPng(canvas, tsFilename(slug(prefix), "png"));
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
