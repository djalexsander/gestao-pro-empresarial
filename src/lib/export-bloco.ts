// Exportação de blocos financeiros em PDF, PNG ou CSV.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { toPng } from "html-to-image";
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
  // html-to-image suporta cores modernas (oklch, color-mix etc.) que o html2canvas v1 não renderiza.
  const bg = getComputedStyle(document.body).backgroundColor || "#ffffff";

  // Clona o elemento para fora do dialog, expandindo qualquer área com scroll
  // (ScrollArea/overflow) para que a captura inclua todas as colunas e linhas.
  const clone = element.cloneNode(true) as HTMLElement;

  // Expande Radix ScrollArea: viewport tem overflow oculto e o conteúdo é limitado.
  clone.querySelectorAll<HTMLElement>("[data-radix-scroll-area-viewport]").forEach((el) => {
    el.style.overflow = "visible";
    el.style.maxHeight = "none";
    el.style.height = "auto";
  });
  // Remove qualquer max-height/overflow restante em filhos
  clone.querySelectorAll<HTMLElement>("*").forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.overflow === "auto" || cs.overflow === "scroll" || cs.overflowX === "auto" || cs.overflowY === "auto") {
      el.style.overflow = "visible";
    }
    if (el.style.maxHeight) el.style.maxHeight = "none";
  });
  // Esconde as scrollbars decorativas do Radix
  clone.querySelectorAll<HTMLElement>("[data-radix-scroll-area-scrollbar]").forEach((el) => {
    el.style.display = "none";
  });

  // Garante largura suficiente para todas as colunas (usa scrollWidth do original).
  const fullWidth = Math.max(element.scrollWidth, element.offsetWidth);
  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.top = "0";
  wrapper.style.left = "-99999px";
  wrapper.style.width = `${fullWidth}px`;
  wrapper.style.background = bg;
  wrapper.style.padding = "16px";
  clone.style.width = "100%";
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);

  try {
    const dataUrl = await toPng(wrapper, {
      pixelRatio: 2,
      backgroundColor: bg,
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
