// Utilitário para exportar dados em CSV (com BOM para Excel reconhecer UTF-8).
// Padrões pt-BR para abrir corretamente no Excel Brasil:
//  - Delimitador ";"
//  - Decimal com vírgula e 2 casas
//  - Datas em DD/MM/YYYY (date) ou DD/MM/YYYY HH:mm (datetime)
//  - Encoding UTF-8 com BOM

export type CsvValue = string | number | boolean | null | undefined | Date;

export type CsvColumnType =
  | "text"
  | "number"
  | "currency"
  | "integer"
  | "date"
  | "datetime";

export interface CsvColumn<T> {
  header: string;
  accessor: (row: T) => CsvValue;
  /** Define o tipo do campo para formatação. Default: detecta automaticamente. */
  type?: CsvColumnType;
}

// ---------- Formatação de datas ----------

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Tenta interpretar um valor como Date sem distorções de timezone.
 * - Date → usa direto
 * - "YYYY-MM-DD" → cria como data local (sem timezone shift)
 * - ISO completo (com T) → Date padrão
 * - "YYYY-MM-DD HH:mm[:ss]" → trata como local
 */
function parseDateValue(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string") return null;

  const s = value.trim();
  // YYYY-MM-DD
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  // YYYY-MM-DD HH:mm[:ss]
  const dateTimeLocal = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (dateTimeLocal) {
    const [, y, m, d, h, mi, se] = dateTimeLocal;
    return new Date(
      Number(y),
      Number(m) - 1,
      Number(d),
      Number(h),
      Number(mi),
      se ? Number(se) : 0,
    );
  }
  // ISO com timezone
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
}

function formatDateBR(d: Date): string {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatDateTimeBR(d: Date): string {
  return `${formatDateBR(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// ---------- Formatação numérica ----------

function formatNumberBR(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return "";
  return n.toFixed(decimals).replace(".", ",");
}

function formatInteger(n: number): string {
  if (!Number.isFinite(n)) return "";
  return String(Math.trunc(n));
}

// ---------- Detecção automática ----------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function autoFormat(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    return formatDateTimeBR(value);
  }
  if (typeof value === "number") {
    // Inteiros sem casa decimal, demais com 2 casas
    return Number.isInteger(value) ? String(value) : formatNumberBR(value, 2);
  }
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  const s = String(value);
  // Se parece data ISO, formata pt-BR
  if (ISO_DATE_RE.test(s)) {
    const d = parseDateValue(s);
    if (d) {
      return s.length <= 10 ? formatDateBR(d) : formatDateTimeBR(d);
    }
  }
  return s;
}

function formatByType(value: CsvValue, type: CsvColumnType): string {
  if (value === null || value === undefined || value === "") return "";
  switch (type) {
    case "date": {
      const d = value instanceof Date ? value : parseDateValue(value as string);
      return d ? formatDateBR(d) : "";
    }
    case "datetime": {
      const d = value instanceof Date ? value : parseDateValue(value as string);
      return d ? formatDateTimeBR(d) : "";
    }
    case "number":
    case "currency": {
      const n = typeof value === "number" ? value : Number(value);
      return formatNumberBR(n, 2);
    }
    case "integer": {
      const n = typeof value === "number" ? value : Number(value);
      return formatInteger(n);
    }
    case "text":
    default:
      return String(value);
  }
}

// ---------- Escape CSV ----------

function escapeCell(value: CsvValue, type?: CsvColumnType): string {
  const s = type ? formatByType(value, type) : autoFormat(value);
  if (s === "") return "";
  // Escape: aspas, separador, quebra de linha
  if (/[";\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ---------- API pública ----------

export function toCSV<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => escapeCell(c.header, "text")).join(";");
  const body = rows
    .map((row) =>
      columns.map((c) => escapeCell(c.accessor(row), c.type)).join(";"),
    )
    .join("\r\n"); // CRLF — melhor compatibilidade com Excel
  return `${head}\r\n${body}`;
}

import { saveText } from "@/lib/desktop-save";

export function downloadCSV(filename: string, csv: string) {
  // BOM UTF-8 para Excel reconhecer acentos
  void saveText(csv, filename, "text/csv;charset=utf-8;", { addBom: true });
}

export function csvFilename(prefix: string, ext: "csv" = "csv"): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${prefix}_${y}-${m}-${day}.${ext}`;
}

/**
 * Exporta `rows` em CSV pt-BR já com cabeçalho institucional da empresa
 * (nome, CNPJ, nome do relatório, período, data/hora) seguido de uma linha
 * em branco antes dos cabeçalhos da tabela. É async, mas pode ser chamado
 * sem `await` — os callers existentes continuam funcionando.
 */
export async function exportRowsToCSV<T>(
  prefix: string,
  rows: T[],
  columns: CsvColumn<T>[],
  opts: { relatorio?: string; periodo?: string | null } = {},
) {
  // Import dinâmico para evitar dependência circular (export-csv ↔ export-empresa-header).
  const { fetchEmpresaHeader, montarCabecalhoCSV } = await import(
    "@/lib/export-empresa-header"
  );
  const empresa = await fetchEmpresaHeader();
  const cabecalho = montarCabecalhoCSV({
    empresa,
    relatorio: opts.relatorio ?? prefix,
    periodo: opts.periodo ?? null,
    exportadoEm: new Date(),
  });
  const csv = toCSV(rows, columns);
  downloadCSV(csvFilename(prefix), cabecalho + csv);
}
