/**
 * Helper unificado para exportar um "card de relatório" da tela /relatorios
 * em PDF, PNG ou CSV usando os mesmos `rows` + `CsvColumn[]` definidos no
 * exporter de cada card. Garante padrão visual idêntico em todos os cards
 * (cabeçalho institucional, período, data/hora) sem duplicar lógica.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
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
} from "@/lib/export-png-canvas";
import { toCSV, downloadCSV, csvFilename, type CsvColumn } from "@/lib/export-csv";
import { saveBytes } from "@/lib/desktop-save";

export type ExportFormato = "pdf" | "png" | "csv";

export interface ExportarRelatorioCardOptions<T> {
  /** Prefixo do arquivo (ex.: "vendas"). */
  prefix: string;
  /** Nome legível do relatório (ex.: "Relatório de vendas"). */
  titulo: string;
  /** Período legível (ex.: "01/04/2026 a 27/04/2026"). Opcional. */
  periodo?: string | null;
  /** Cards de resumo opcionais (somente PDF/PNG). */
  resumo?: { label: string; valor: string; tone?: CanvasResumoCard["tone"] }[];
  rows: T[];
  columns: CsvColumn<T>[];
}

function tsFilename(prefix: string, ext: string): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${prefix}_${y}-${m}-${day}.${ext}`;
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

// Reaproveita a lógica de formatação por tipo do export-csv (datas/moeda pt-BR).
// Como `escapeCell` não é exportado, replicamos a formatação leve aqui usando a
// API pública: geramos um CSV de uma única linha e dividimos. Como esse caminho
// é só para PDF/PNG (poucas linhas), o custo é desprezível e mantém consistência.
function formatRowForDisplay<T>(row: T, cols: CsvColumn<T>[]): string[] {
  // Trick: usa toCSV para uma linha só e split por ";".
  // Mas valores com ";" ficariam quoted, o que torna split frágil. Em vez disso,
  // usamos o accessor diretamente e formatamos manualmente apenas os tipos
  // mais comuns; texto cai num String() padrão.
  return cols.map((c) => {
    const v = c.accessor(row);
    if (v == null || v === "") return "";
    const t = c.type;
    if (v instanceof Date) {
      return t === "date"
        ? v.toLocaleDateString("pt-BR")
        : v.toLocaleString("pt-BR");
    }
    if (typeof v === "number") {
      if (t === "integer") return String(Math.trunc(v));
      if (t === "currency" || t === "number") {
        return v.toLocaleString("pt-BR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
      }
      return String(v);
    }
    if (typeof v === "boolean") return v ? "Sim" : "Não";
    const s = String(v);
    // Tenta interpretar ISO date
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const d = new Date(s.length <= 10 ? `${s}T00:00:00` : s);
      if (!isNaN(d.getTime())) {
        return t === "datetime" || s.length > 10
          ? d.toLocaleString("pt-BR")
          : d.toLocaleDateString("pt-BR");
      }
    }
    return s;
  });
}

export async function exportarRelatorioCard<T>(
  formato: ExportFormato,
  opts: ExportarRelatorioCardOptions<T>,
) {
  const { prefix, titulo, periodo, resumo, rows, columns } = opts;

  if (formato === "csv") {
    const empresa = await fetchEmpresaHeader();
    const cabecalho = montarCabecalhoCSV({
      empresa,
      relatorio: titulo,
      periodo: periodo ?? null,
      exportadoEm: new Date(),
    });
    const tabela = toCSV(rows, columns);
    downloadCSV(csvFilename(slug(prefix)), cabecalho + tabela);
    return;
  }

  if (formato === "png") {
    const empresa = await fetchEmpresaHeader();
    const tableRows = rows.map((r) => formatRowForDisplay(r, columns));
    const canvas = await renderReportCanvas({
      empresa,
      titulo,
      periodo: periodo ?? null,
      exportadoEm: new Date(),
      resumo: resumo as CanvasResumoCard[] | undefined,
      tabela: {
        columns: columns.map((c) => ({
          header: c.header,
          align:
            c.type === "currency" || c.type === "number" || c.type === "integer"
              ? "right"
              : "left",
          weight: 1,
        })),
        rows: tableRows,
        emptyMessage: "Sem dados para exibir.",
      },
    });
    downloadCanvasAsPng(canvas, tsFilename(slug(prefix), "png"));
    return;
  }

  // PDF
  const empresa = await fetchEmpresaHeader();
  const exportadoEm = new Date();
  const doc = new jsPDF({
    orientation: columns.length > 6 ? "landscape" : "portrait",
    unit: "mm",
    format: "a4",
  });

  let cursorY = desenharCabecalhoPDF(doc, {
    empresa,
    titulo,
    periodo: periodo ?? null,
    exportadoEm,
  });

  if (resumo && resumo.length) {
    autoTable(doc, {
      startY: cursorY,
      head: [["Indicador", "Valor"]],
      body: resumo.map((r) => [r.label, r.valor]),
      theme: "grid",
      headStyles: { fillColor: [40, 40, 40] },
      styles: { fontSize: 10 },
      margin: { left: 14, right: 14 },
    });
    // @ts-expect-error lastAutoTable injetado pelo autotable
    cursorY = doc.lastAutoTable.finalY + 6;
  }

  autoTable(doc, {
    startY: cursorY,
    head: [columns.map((c) => c.header)],
    body: rows.map((r) => formatRowForDisplay(r, columns)),
    theme: "striped",
    headStyles: { fillColor: [30, 80, 160] },
    styles: { fontSize: 8, cellPadding: 2 },
    margin: { left: 14, right: 14 },
  });

  adicionarRodapePaginacao(doc);

  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(
    `Gerado em ${exportadoEm.toLocaleString("pt-BR")}`,
    14,
    doc.internal.pageSize.getHeight() - 8,
  );
  doc.setTextColor(0);

  void saveBytes(
    new Uint8Array(doc.output("arraybuffer")),
    tsFilename(slug(prefix), "pdf"),
    "application/pdf",
  );
}
