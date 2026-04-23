// Utilitário para exportar dados em CSV (com BOM para Excel reconhecer UTF-8).

export type CsvValue = string | number | boolean | null | undefined | Date;

export interface CsvColumn<T> {
  header: string;
  accessor: (row: T) => CsvValue;
}

function escapeCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (value instanceof Date) {
    s = value.toISOString();
  } else if (typeof value === "number") {
    // Usa vírgula decimal pt-BR para Excel BR
    s = String(value).replace(".", ",");
  } else {
    s = String(value);
  }
  // Escape de aspas e quebras
  if (/[";\n\r]/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCSV<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => escapeCell(c.header)).join(";");
  const body = rows
    .map((row) => columns.map((c) => escapeCell(c.accessor(row))).join(";"))
    .join("\n");
  return `${head}\n${body}`;
}

export function downloadCSV(filename: string, csv: string) {
  // BOM para UTF-8 (faz Excel ler acentos corretamente)
  const blob = new Blob([`\uFEFF${csv}`], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function csvFilename(prefix: string, ext: "csv" = "csv"): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${prefix}_${y}-${m}-${day}.${ext}`;
}

export function exportRowsToCSV<T>(
  prefix: string,
  rows: T[],
  columns: CsvColumn<T>[],
) {
  const csv = toCSV(rows, columns);
  downloadCSV(csvFilename(prefix), csv);
}
