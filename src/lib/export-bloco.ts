// Exportação de blocos financeiros em PDF, PNG ou CSV.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import html2canvas from "html2canvas";
import { exportRowsToCSV, type CsvColumn } from "@/lib/export-csv";

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
  subtitulo?: string;
  resumo?: { label: string; valor: string }[];
  tabela?: PdfTableSpec<T>;
  rodape?: string;
}

export function exportarBlocoPDF<T>(opts: ExportPdfOptions<T>) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(opts.titulo, 14, 18);

  if (opts.subtitulo) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(opts.subtitulo, 14, 24);
    doc.setTextColor(0);
  }

  let cursorY = 32;

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

  const finalText = opts.rodape ?? `Gerado em ${new Date().toLocaleString("pt-BR")}`;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(finalText, 14, doc.internal.pageSize.getHeight() - 8);

  doc.save(tsFilename(slug(opts.titulo), "pdf"));
  return pageW;
}

export async function exportarBlocoPNG(element: HTMLElement, prefix: string) {
  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: getComputedStyle(document.body).backgroundColor || "#ffffff",
    logging: false,
    useCORS: true,
  });
  const url = canvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.href = url;
  link.download = tsFilename(slug(prefix), "png");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function exportarBlocoCSV<T>(prefix: string, rows: T[], cols: CsvColumn<T>[]) {
  exportRowsToCSV(slug(prefix), rows, cols);
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
