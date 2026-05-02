import { useState } from "react";
import { Download, FileText, FileSpreadsheet, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  exportarRelatorioCard,
  type ExportFormato,
} from "@/lib/export-relatorio-card";
import type { CsvColumn } from "@/lib/export-csv";

export interface SecaoExportRow {
  indicador: string;
  valor: number;
  quantidade?: number | null;
  filtro?: string | null;
}

interface Props {
  /** Prefixo do arquivo (ex.: "financeiro_posicao"). */
  prefix: string;
  /** Título legível (ex.: "Posição financeira"). */
  titulo: string;
  /** Período legível (ex.: "01/04/2026 a 27/04/2026"). */
  periodo?: string | null;
  /** Linha por indicador da seção. */
  rows: SecaoExportRow[];
  /** Tooltip / disabled. */
  disabled?: boolean;
}

const COLUMNS: CsvColumn<SecaoExportRow>[] = [
  { header: "Indicador", accessor: (r) => r.indicador, type: "text" },
  { header: "Valor (R$)", accessor: (r) => r.valor, type: "currency" },
  { header: "Quantidade", accessor: (r) => r.quantidade ?? "", type: "integer" },
  { header: "Filtro aplicado", accessor: (r) => r.filtro ?? "", type: "text" },
];

/**
 * Botão "Exportar" para uma seção do Financeiro. Reutiliza o pipeline
 * `exportarRelatorioCard` (PDF/PNG/CSV) com cabeçalho institucional, período e
 * cards de resumo. Cada chamada envia APENAS as linhas da própria seção.
 */
export function SecaoExport({ prefix, titulo, periodo, rows, disabled }: Props) {
  const [busy, setBusy] = useState(false);

  async function handle(formato: ExportFormato) {
    if (rows.length === 0) {
      toast.info("Nada para exportar nesta seção.");
      return;
    }
    setBusy(true);
    toast.loading("Gerando exportação...", { id: `export-${prefix}` });
    try {
      await exportarRelatorioCard(formato, {
        prefix,
        titulo,
        periodo: periodo ?? null,
        // Cards de resumo (PDF/PNG): mesmos indicadores formatados.
        resumo: rows.map((r) => ({
          label: r.indicador,
          valor: r.valor.toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL",
          }),
          tone: r.valor < 0 ? "danger" : undefined,
        })),
        rows,
        columns: COLUMNS,
      });
      toast.success("Exportação concluída.", { id: `export-${prefix}` });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao exportar.", {
        id: `export-${prefix}`,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 px-2.5 text-xs"
          disabled={disabled || busy}
        >
          <Download className="h-3.5 w-3.5" />
          Exportar
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => handle("csv")}>
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Exportar CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handle("pdf")}>
          <FileText className="mr-2 h-4 w-4" />
          Exportar PDF
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handle("png")}>
          <ImageIcon className="mr-2 h-4 w-4" />
          Exportar PNG
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
